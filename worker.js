export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
        status: 405,
        headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
      });
    }

    try {
      const body = await request.json();
      const topic = body.topic || '';
      const fullPrompt = body.fullPrompt || '';
      const previousContent = body.previousContent || '';
      const partNumber = body.partNumber || 1;
      const language = body.language || 'english';
      const depth = body.depth || 'standard';

      if (!topic && !fullPrompt) {
        return new Response(JSON.stringify({ success: false, error: 'Topic is required' }), {
          status: 400,
          headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
        });
      }

      const apiKey = env.GEMINI_KEY_2 || env.GEMINI_API_KEY;
      if (!apiKey) {
        return new Response(JSON.stringify({ success: false, error: 'API key not configured' }), {
          status: 500,
          headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
        });
      }

      const languageInstructions = {
        english: 'Respond ONLY in English.',
        hindi: 'Respond ONLY in Hindi (Devanagari script).',
        hinglish: 'Respond in Hinglish (Hindi words in English letters, mixed with English).'
      };

      const depthInstructions = {
        basic: 'Keep content SIMPLE. Only key points.',
        standard: 'Include examples for each concept.',
        deep: 'Include full explanations, real-world examples, extra facts.'
      };

      const userRequest = fullPrompt.trim() || topic.trim();
      const firstLine = userRequest.split('\n')[0].trim();
      const chapterTitle = firstLine.slice(0, 100);

      let prompt = '';

      if (partNumber === 1) {
        prompt = 'You are an expert teacher writing handwritten study notes. Output ONLY the notes.\n\n'
          + 'TOPIC: ' + userRequest + '\n\n'
          + 'DEPTH: ' + depth + '\n'
          + 'LANGUAGE: ' + languageInstructions[language] + '\n\n'
          + 'Write notes in this format:\n\n'
          + '# ' + chapterTitle + '\n\n'
          + '## Section Name\n'
          + 'Definition: ...\n'
          + '- bullet point\n'
          + '$$formula$$\n'
          + '[DIAGRAM: solar_panel]\n\n'
          + 'RULES:\n'
          + '1. Output ONLY notes. NOTHING else.\n'
          + '2. NO thinking, NO verification.\n'
          + '3. Use ## for sections, ### for sub-sections\n'
          + '4. Use "- " for bullets\n'
          + '5. Definitions: "Definition: ..."\n'
          + '6. Formulas: $$formula$$ on own line\n'
          + '7. Diagrams: [DIAGRAM: name] on own line\n'
          + '8. NO bold, NO italics\n'
          + '9. Start directly with # heading.\n\n'
          + 'Begin now:';
      } else {
        const prevTail = previousContent.slice(-3000);
        prompt = 'Continuing notes. PART ' + partNumber + '.\n\n'
          + 'TOPIC: ' + userRequest + '\n'
          + 'DEPTH: ' + depth + '\n'
          + 'LANGUAGE: ' + languageInstructions[language] + '\n\n'
          + '=== PREVIOUSLY COVERED (DO NOT REPEAT) ===\n'
          + prevTail + '\n'
          + '=== END ===\n\n'
          + 'CONTINUE with NEXT topics.\n\n'
          + 'RULES:\n'
          + '1. DO NOT repeat previous content\n'
          + '2. Start with ## heading for NEXT topic\n'
          + '3. Continue naturally\n'
          + '4. If ALL covered, write ONLY: "ALL_TOPICS_COVERED"\n'
          + '5. NO thinking, NO verification\n'
          + '6. NO bold, NO italics\n\n'
          + 'Begin now:';
      }

      const models = [
        'gemini-flash-latest',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-3.1-pro-preview'
      ];

      let lastError = '';

      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        try {
          const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;

          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 3000,
                topP: 0.95
              }
            })
          });

          const data = await response.json();

          if (!response.ok) {
            if (data && data.error && data.error.message) {
              lastError = data.error.message;
            } else {
              lastError = 'HTTP ' + response.status;
            }
            continue;
          }

          let text = '';
          if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) {
            text = data.candidates[0].content.parts[0].text;
          }

          if (!text) {
            lastError = 'Empty response';
            continue;
          }

          const trimmedText = text.trim();
          const allCovered = /^ALL_TOPICS_COVERED\s*$/i.test(trimmedText);

          return new Response(JSON.stringify({
            success: true,
            partNumber: partNumber,
            model: model,
            text: allCovered ? '' : trimmedText,
            allCovered: allCovered
          }), {
            status: 200,
            headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
          });

        } catch (err) {
          lastError = err.message;
          continue;
        }
      }

      return new Response(JSON.stringify({
        success: false,
        error: 'AI generation failed: ' + lastError
      }), {
        status: 500,
        headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
      });

    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Server error: ' + err.message
      }), {
        status: 500,
        headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
      });
    }
  }
};
