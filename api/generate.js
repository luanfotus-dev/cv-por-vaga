export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'GROQ_API_KEY não configurada no Vercel.'
    });
  }

  try {
    const { system, messages } = req.body;

    const normalizeContent = (content) => {
      if (typeof content === 'string') return content;

      if (Array.isArray(content)) {
        return content
          .filter((part) => part?.type === 'text')
          .map((part) => part.text || '')
          .join('\n');
      }

      return '';
    };

    const extractGoogleDocIds = (text) => {
      if (!text) return [];

      const regex = /https?:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9-_]+)/g;
      const ids = [];
      let match;

      while ((match = regex.exec(text)) !== null) {
        ids.push(match[1]);
      }

      return [...new Set(ids)];
    };

    const fetchGoogleDocText = async (docId) => {
      const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

      const response = await fetch(exportUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const text = await response.text();

      if (!response.ok) {
        throw new Error('Não foi possível acessar o Google Docs.');
      }

      const lowerText = text.toLowerCase();

      const looksBlocked =
        lowerText.includes('sign in') ||
        lowerText.includes('request access') ||
        lowerText.includes('access denied') ||
        lowerText.includes('você precisa de acesso') ||
        lowerText.includes('solicitar acesso');

      if (looksBlocked || text.trim().startsWith('<!DOCTYPE html')) {
        throw new Error(
          'O Google Docs não está público. Altere o compartilhamento para "qualquer pessoa com o link pode visualizar".'
        );
      }

      return text.trim();
    };

    const allInputText = [
      system || '',
      ...(Array.isArray(messages)
        ? messages.map((msg) => normalizeContent(msg?.content))
        : [])
    ].join('\n');

    const googleDocIds = extractGoogleDocIds(allInputText);

    let docsContext = '';

    if (googleDocIds.length > 0) {
      const docsTexts = [];

      for (const docId of googleDocIds) {
        try {
          const docText = await fetchGoogleDocText(docId);

          docsTexts.push(
            `CONTEÚDO EXTRAÍDO DO GOOGLE DOCS:\n${docText.slice(0, 30000)}`
          );
        } catch (err) {
          return res.status(400).json({
            error: err.message
          });
        }
      }

      docsContext = docsTexts.join('\n\n---\n\n');
    }

    const groqMessages = [];

    if (system) {
      groqMessages.push({
        role: 'system',
        content: String(system)
      });
    }

    if (docsContext) {
      groqMessages.push({
        role: 'system',
        content:
          'Use o conteúdo abaixo como contexto principal quando o usuário pedir análise, resumo ou reescrita do Google Docs.\n\n' +
          docsContext
      });
    }

    if (Array.isArray(messages)) {
      for (const message of messages) {
        const content = normalizeContent(message?.content);

        if (!content.trim()) continue;

        const role = ['user', 'assistant', 'system'].includes(message?.role)
          ? message.role
          : 'user';

        groqMessages.push({
          role,
          content
        });
      }
    }

    if (!groqMessages.length) {
      return res.status(400).json({
        error: 'Nenhuma mensagem válida foi enviada.'
      });
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: groqMessages,
        temperature: 0.7,
        max_completion_tokens: 2500
      })
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: 'Resposta inválida da Groq: ' + text.slice(0, 300)
      });
    }

    if (!response.ok) {
      const msg = data?.error?.message || JSON.stringify(data);

      return res.status(response.status).json({
        error: msg
      });
    }

    const generated = data?.choices?.[0]?.message?.content || '';

    if (!generated) {
      return res.status(500).json({
        error: 'Resposta vazia da Groq.'
      });
    }

    return res.status(200).json({
      content: [
        {
          type: 'text',
          text: generated
        }
      ]
    });

  } catch (err) {
    return res.status(500).json({
      error: 'Erro de conexão: ' + err.message
    });
  }
}
