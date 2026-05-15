export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no Vercel.' });
  }

  try {
    const { system, messages } = req.body;

    const userMessage = messages?.[0]?.content;
    let userText = '';

    if (typeof userMessage === 'string') {
      userText = userMessage;
    } else if (Array.isArray(userMessage)) {
      userText = userMessage.filter(p => p.type === 'text').map(p => p.text).join('\n');
    }

    const fullPrompt = system ? `${system}\n\n${userText}` : userText;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: { maxOutputTokens: 2500, temperature: 0.7 }
        })
      }
    );

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
      return res.status(500).json({ error: 'Resposta inválida: ' + text.slice(0, 300) });
    }

    if (!response.ok) {
      const msg = data?.error?.message || JSON.stringify(data);
      return res.status(response.status).json({ error: msg });
    }

    const generated = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!generated) return res.status(500).json({ error: 'Resposta vazia do Gemini.' });

    return res.status(200).json({
      content: [{ type: 'text', text: generated }]
    });

  } catch (err) {
    return res.status(500).json({ error: 'Erro de conexão: ' + err.message });
  }
}
