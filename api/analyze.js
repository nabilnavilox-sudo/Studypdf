module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  const { text, lang } = req.body || {};

  if (!text || typeof text !== 'string' || text.trim().length < 20) {
    res.status(400).json({ error: 'Texte du PDF manquant ou trop court.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Clé API non configurée sur le serveur.' });
    return;
  }

  const langNames = { fr: 'français', ar: 'arabe standard', darija: 'darija marocain (arabe dialectal, transcrit en lettres arabes)' };
  const langLabel = langNames[lang] || 'français';

  // On limite la taille du texte envoyé pour rester rapide et économique
  const truncatedText = text.slice(0, 15000);

  const prompt = `Tu es un assistant pédagogique. Voici le texte extrait d'un cours (peut contenir des imperfections d'extraction) :

"""
${truncatedText}
"""

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown, respectant exactement cette structure :

{
  "resume": "un résumé clair et structuré du cours, en ${langLabel}",
  "fiche": "une fiche de révision structurée avec les points clés, en ${langLabel}",
  "qcm": [
    { "question": "...", "options": ["...", "...", "...", "..."], "reponse": "..." }
  ],
  "flashcards": [
    { "question": "...", "reponse": "..." }
  ]
}

Génère exactement 10 éléments dans "qcm" et exactement 10 éléments dans "flashcards". Tout le contenu doit être en ${langLabel}.

RÈGLE IMPORTANTE POUR LES MATHÉMATIQUES :
Chaque fois qu'une expression mathématique apparaît (formule, fraction, indice, exposant, racine, équation, symbole), tu dois l'écrire en notation LaTeX, jamais en texte brut.
- Pour une formule courte insérée dans une phrase : entoure-la de signes dollar simples, exemple : $x^2 + y^2 = z^2$
- Pour une formule importante isolée : entoure-la de doubles signes dollar, exemple : $$c(t_{1/2}) = x_{max}$$
- N'écris jamais une formule sous forme de texte brut comme "c(t1/2)=x_max" ou "x_max" : utilise toujours $c(t_{1/2}) = x_{max}$.
- Attention : dans le JSON, chaque backslash LaTeX (comme \\frac, \\sqrt) doit être échappé correctement (double backslash) pour rester un JSON valide.`;

  try {
    const geminiRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      res.status(502).json({ error: 'Erreur côté IA : ' + errText.slice(0, 300) });
      return;
    }

    const data = await geminiRes.json();
    let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Nettoyage au cas où l'IA aurait ajouté des balises ```json
    rawText = rawText.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    // Filet de sécurité : si du texte reste avant/après le JSON, on isole
    // uniquement la portion entre la première "{" et la dernière "}".
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      rawText = rawText.slice(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      res.status(502).json({ error: "La réponse de l'IA n'était pas un JSON valide." });
      return;
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
};
