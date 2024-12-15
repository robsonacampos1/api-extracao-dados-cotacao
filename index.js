const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Função para extrair o UUID da URL
function extractUUID(url) {
    try {
        const parts = url.split('/');
        const uuid = parts[parts.length - 2];
        if (!uuid || !uuid.match(/[0-9a-fA-F-]{36}/)) {
            throw new Error("UUID inválido na URL.");
        }
        return uuid;
    } catch (error) {
        console.error("Erro ao extrair UUID:", error.message);
        return null;
    }
}

// Função para chamar a API 1
async function fetchAPI1(uuid) {
    try {
        const url = `https://api.paineldocorretor.net/api/cotacao/${uuid}?authorize=false&cache=false`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error("Erro na API 1:", error.response?.data || error.message);
        return null;
    }
}

// Função para chamar a API 3 e processar os planos com base nos atributos da API 1
async function fetchAPI3AndCalculate(operadoraId, modalidade, produtoId, cidade, ramo, token, vidas, planoId) {
    const baseUrl = `https://api.paineldocorretor.net/api/operadoras/${operadoraId}/${modalidade}/${produtoId}/valores`;
    const params = new URLSearchParams({
        cidade,
        modalidade,
        ramo
    });

    const headers = {
        'Authorization': `Token ${token}`
    };

    try {
        const response = await fetch(`${baseUrl}?${params.toString()}`, { method: 'GET', headers });
        if (!response.ok) {
            throw new Error(`Erro na API 3: ${response.statusText}`);
        }

        const data = await response.json();

        // Filtrar apenas o plano específico com base no ID do plano do grupo da API 1
        const item = data.find((item) => item.planos.some((p) => p.id === planoId));
        if (!item) return null;

        const plano = item.planos.find((p) => p.id === planoId);
        if (!plano) return null;

        // Retornar no formato esperado sem o valor total
        return {
            id: plano.id,
            plano: plano.nome,
            acomodacao: plano.acomodacao,
            coparticipacao: item.coparticipacaoTipo || "N/A",
            detalhesFaixas: Object.entries(vidas).map(([faixa, qtd]) => ({
                faixaEtaria: faixa,
                quantidadeVidas: qtd,
                valorPorVida: plano.valores[faixa]?.toFixed(2) || "0.00",
                subtotal: (plano.valores[faixa] * qtd)?.toFixed(2) || "0.00"
            }))
        };
    } catch (error) {
        console.error("Erro na API 3:", error.message);
        return null;
    }
}

// Rota principal
app.post('/process-url', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: "A URL é obrigatória." });
        }

        const uuid = extractUUID(url);
        if (!uuid) {
            return res.status(400).json({ error: "Não foi possível extrair o UUID da URL." });
        }

        const api1Response = await fetchAPI1(uuid);
        if (!api1Response) {
            return res.status(500).json({ error: "Erro ao consultar a API 1." });
        }

        const cidade = api1Response.filtro.cidade;
        const modalidade = api1Response.filtro.modalidade;
        const token = api1Response.token;
        const grupos = api1Response.grupos;

        const results = [];

        for (const grupo of grupos) {
            const grupoResult = {
                nomeGrupo: grupo.nome,
                planos: []
            };

            for (const [cenarioKey, cenario] of Object.entries(grupo.cenarios)) {
                const operadoraId = cenario.operadora;
                const produtoId = cenario.produto;
                const planoId = cenario.plano;

                // Processar somente planos que pertencem ao grupo
                const api3Result = await fetchAPI3AndCalculate(
                    operadoraId,
                    modalidade,
                    produtoId,
                    cidade,
                    "Saúde",
                    token,
                    grupo.vidas,
                    planoId
                );

                if (api3Result) {
                    grupoResult.planos.push(api3Result);
                }
            }

            if (grupoResult.planos.length > 0) {
                results.push(grupoResult);
            }
        }

        await mandarJsonParaWebhook(results);
        res.json(results);
    } catch (error) {
        console.error("Erro Geral:", error.message);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

const mandarJsonParaWebhook = async (dados) => {
    console.log(dados);
    const url = 'https://hooks.zapier.com/hooks/catch/6901379/2iz5hot/';
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            dados: dados
        })
    });
    console.log(response);
    return response;
}

// Iniciar o servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});