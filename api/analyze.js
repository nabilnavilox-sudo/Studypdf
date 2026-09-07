// api/analyze.js - Endpoint Vercel pour l'analyse du PDF

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Clé API Gemini non configurée sur le serveur.' });
  }

  try {
    const { text, lang = 'fr' } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Le texte du document est vide.' });
    }

    const primaryModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
    const fallbackModel = 'gemini-2.5-flash';

    const langInstruction = {
      fr: 'Rédige TOUT le contenu impérativement en FRANÇAIS.',
      ar: 'Rédige TOUT le contenu impérativement en ARABE classique.',
      darija: 'Rédige TOUT le contenu impérativement en DARIJA marocain (en utilisant l’alphabet latin ou arabe, de manière claire et fluide).'
    }[lang] || 'Rédige TOUT le contenu impérativement en FRANÇAIS.';

    const systemPrompt = `Tu es un assistant pédagogique expert.
Analyse le texte du cours ci-dessous et génère une réponse STRICTEMENT au format JSON valide, sans balises de code Markdown (\`\`\`json ... \`\`\`), uniquement du texte JSON brut.

Consignes de langue :
${langInstruction}

Structure JSON exacte attendue :
{
  "resume": "Un résumé synthétique et structuré du cours.",
  "fiche": "Une fiche de révision détaillée sous forme de points clés, définitions importantes et formules à retenir.",
  "qcm": [
    {
      "question": "Texte de la question 1",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "reponse": "Option A",
      "explication": "Explication rapide de la réponse correcte."
    }
  ],
  "flashcards": [
    {
      "question": "Question / Notion",
      "reponse": "Explication / Réponse courte"
    }
  ]
}

Génère au moins 5 questions QCM et au moins 5 flashcards.
N'ajoute aucun texte avant ou après le JSON.`;

    const callGeminiAPI = async (modelName) => {
      const url = `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`;
      
      const payload = {
        contents: [
          {
            role: 'user',
            parts: [
              { text: systemPrompt },
              { text: `\n\nCONTENU DU COURS :\n${text}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json'
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Erreur API Google (${response.status})`);
      }

      return await response.json();
    };

    let geminiResponse;
    try {
      geminiResponse = await callGeminiAPI(primaryModel);
    } catch (primaryErr) {
      console.warn(`Échec avec le modèle ${primaryModel}, tentative avec ${fallbackModel}...`, primaryErr.message);
      geminiResponse = await callGeminiAPI(fallbackModel);
    }

    const rawContent = geminiResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      throw new Error("L'IA n'a pas renvoyé de réponse exploitable.");
    }

    const cleanedJson = rawContent
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsedData = JSON.parse(cleanedJson);

    return res.status(200).json({
      resume: parsedData.resume || '',
      fiche: parsedData.fiche || '',
      qcm: parsedData.qcm || [],
      flashcards: parsedData.flashcards || []
    });

  } catch (error) {
    console.error('Erreur API analyze.js :', error);
    return res.status(500).json({
      error: 'Erreur lors de la génération par l’IA : ' + error.message
    });
  }
}
