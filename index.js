const express = require('express');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
app.use(express.json());

const BASE_URL = "https://api.paineldocorretor.net";

// Função para extrair o UUID de uma URL completa
function extractUUID(url) {
    const match = url.match(/\/cotacoes\/(.+?)\/share/);
    return match ? match[1] : null;
}

// Função para obter dados da API 1
async function fetchAPI1(uuid) {
    try {
        const url = `${BASE_URL}/api/cotacao/${uuid}?authorize=false&cache=false`;
        const response = await axios.get(url, {
            httpsAgent: new HttpsProxyAgent('http://30530355dfd1c4ddf083:057c950a1fb4f640@gw.dataimpulse.com:823')
        });
        return response.data;
    } catch (error) {
        console.error("Erro na API 1:", error.response?.data || error.message);
        return null;
    }
}

// Função para obter dados da API 3
async function fetchAPI3(operadoraId, modalidade, produtoId, cidade, token) {
    try {
        const url = `${BASE_URL}/api/operadoras/${operadoraId}/${modalidade}/${produtoId}/valores?cidade=${encodeURIComponent(cidade)}&modalidade=${modalidade}&ramo=Saúde`;
        const headers = { Authorization: `Token ${token}` };
        const response = await axios.get(url, { headers });
        return response.data;
    } catch (error) {
        console.error("Erro na API 3:", error.response?.data || error.message);
        return null;
    }
}

// Função para processar os dados da API 1 e integrar com a API 3
async function processarGruposEPlanos(uuid) {
    const api1Response = await fetchAPI1(uuid);
    if (!api1Response) {
        throw new Error("Erro ao consultar a API 1.");
    }

    const grupos = api1Response.grupos;
    const cidade = api1Response.filtro.cidade;
    const modalidade = api1Response.filtro.modalidade;
    const token = api1Response.token;

    // Calcula o total de vidas da cotação inteira
    const totalVidas = grupos.reduce((total, grupo) => {
        return total + Object.values(grupo.vidas).reduce((grupoTotal, qtd) => grupoTotal + qtd, 0);
    }, 0);

    const resultado = [];

    for (const grupo of grupos) {
        const administradoras = new Set(Object.values(grupo.cenarios).map(cenario => cenario.administradora));

        for (const adminId of administradoras) {
            const produtosMap = new Map();

            for (const [key, cenario] of Object.entries(grupo.cenarios)) {
                if (cenario.administradora !== adminId) continue;

                const api3Response = await fetchAPI3(cenario.operadora, modalidade, cenario.produto, cidade, token);

                if (api3Response) {
                    // Filtra a tabela correta baseada no intervalo de vidas e ID da tabela
                    const tabelaValida = api3Response.find(tabela => {
                        return tabela.qtdVidaMin <= totalVidas && tabela.qtdVidaMax >= totalVidas && tabela.id === cenario.tabela;
                    });

                    if (tabelaValida) {
                        for (const plano of tabelaValida.planos) {
                            if (plano.id === cenario.plano) { // Validação adicional pelo ID do plano
                                const faixaEtariaAPI1 = Object.keys(grupo.vidas);
                                const detalhesFaixas = Object.entries(plano.valores || {}).reduce((acumulador, [faixa, valor]) => {
                                    if (faixaEtariaAPI1.includes(faixa) && valor > 0) {
                                        acumulador.push({
                                            faixaEtaria: faixa,
                                            quantidadeVidas: grupo.vidas[faixa] || 0,
                                            valorPorVida: valor,
                                            subtotal: (grupo.vidas[faixa] || 0) * valor
                                        });
                                    }
                                    return acumulador;
                                }, []);

                                if (detalhesFaixas.length > 0) {
                                    const total = detalhesFaixas.reduce((sum, faixa) => sum + faixa.subtotal, 0);

                                    resultado.push({
                                        id: plano.id,
                                        plano: plano.nome,
                                        acomodacao: plano.acomodacao,
                                        coparticipacao: tabelaValida.coparticipacaoTipo,
                                        detalhesFaixas,
                                        total: total.toFixed(2)
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    return resultado;
}

// Endpoint do Express para capturar a URL dinâmica
app.post('/processar', async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: "A URL é obrigatória." });
        }

        const uuid = extractUUID(url);

        if (!uuid) {
            return res.status(400).json({ error: "UUID não pôde ser extraído da URL." });
        }

        const dados = await processarGruposEPlanos(uuid);
        res.json(dados);
    } catch (error) {
        console.error("Erro ao processar grupos e planos:", error.message);
        res.status(500).json({ error: "Erro interno ao processar grupos e planos." });
    }
});

// Inicialização do servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});