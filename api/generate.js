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

    const groqMessages = [];

    if (system) {
      groqMessages.push({
        role: 'system',
        content: system
      });
    }

    if (Array.isArray(messages)) {
      for (const message of messages) {
        let content = '';

        if (typeof message?.content === 'string') {
          content = message.content;
        } else if (Array.isArray(message?.content)) {
          content = message.content
            .filter((part) => part.type === 'text')
            .map((part) => part.text)
            .join('\n');
        }

        if (content.trim()) {
          groqMessages.push({
            role: message.role || 'user',
            content
          });
        }
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
        model: 'llama-3.3-70b-versatile',
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
