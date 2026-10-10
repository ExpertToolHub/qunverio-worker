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

      const groqKey = env.GROQ_API_KEY;
      const geminiKey = env.GEMINI_KEY_2 || env.GEMINI_API_KEY;

      if (!groqKey && !geminiKey) {
        return new Response(JSON.stringify({ success: false, error: 'No API key configured' }), {
          status: 500,
          headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
        });
      }

      // LANGUAGE INSTRUCTIONS — UPDATED
      const languageInstructions = {
        english: 'Respond ONLY in English. Use simple, clear English.',
        hindi: 'Respond ONLY in pure Hindi using Devanagari script (देवनागरी). Every word must be in Hindi. Do NOT use English words. Do NOT use Roman letters. Example: "सौर ऊर्जा एक नवीकरणीय ऊर्जा स्रोत है। सूर्य से प्राप्त ऊर्जा को सौर ऊर्जा कहते हैं।"',
        'hindi-english': 'Respond in Hindi + English mix. Use Hindi (Devanagari script) for explanations and English for technical terms. Example: "सौर ऊर्जा (Solar Energy) एक renewable source है। यह energy का सबसे बड़ा source है।" Keep it natural, easy to understand, and student-friendly.',
        hinglish: 'Respond in Hinglish — Hindi words written in English (Roman) letters, mixed with English. Example: "Solar energy ek renewable source hai. Yeh energy ka sabse bada source hai." Do NOT use Devanagari script.'
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
          + '2. NO thinking, NO verification, NO meta-commentary.\n'
          + '3. Use ## for sections, ### for sub-sections\n'
          + '4. Use "- " for bullets\n'
          + '5. Definitions: "Definition: ..."\n'
          + '6. Formulas: $$formula$$ on own line\n'
          + '7. Diagrams: [DIAGRAM: name] on own line\n'
          + '8. NO bold, NO italics\n'
          + '9. Start directly with # heading.\n'
          + '10. STRICTLY follow the LANGUAGE instruction above.\n\n'
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
          + '6. NO bold, NO italics\n'
          + '7. STRICTLY follow the LANGUAGE instruction above.\n\n'
          + 'Begin now:';
      }

      let lastError = '';

      // PRIORITY 1: GROQ
      if (groqKey) {
        const groqModels = [
          'llama-3.3-70b-versatile',
          'llama-3.1-70b-versatile',
          'llama-3.1-8b-instant',
          'mixtral-8x7b-32768'
        ];

        for (let i = 0; i < groqModels.length; i++) {
          const model = groqModels[i];
          try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + groqKey
              },
              body: JSON.stringify({
                model: model,
                messages: [
                  { role: 'system', content: 'You are an expert teacher. Output ONLY study notes. No thinking, no meta-commentary. STRICTLY follow language instructions.' },
                  { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 4000
              })
            });

            const data = await response.json();

            if (!response.ok) {
              lastError = (data && data.error && data.error.message) || ('Groq HTTP ' + response.status);
              continue;
            }

            let text = '';
            if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
              text = data.choices[0].message.content;
            }

            if (!text) {
              lastError = 'Groq empty response';
              continue;
            }

            const trimmedText = text.trim();
            const allCovered = /^ALL_TOPICS_COVERED\s*$/i.test(trimmedText);

            return new Response(JSON.stringify({
              success: true,
              partNumber: partNumber,
              model: 'groq:' + model,
              text: allCovered ? '' : trimmedText,
              allCovered: allCovered
            }), {
              status: 200,
              headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
            });

          } catch (err) {
            lastError = 'Groq: ' + err.message;
            continue;
          }
        }
      }

      // PRIORITY 2: GEMINI FALLBACK
      if (geminiKey) {
        const geminiModels = [
          'gemini-flash-latest',
          'gemini-2.5-flash',
          'gemini-2.5-flash-lite',
          'gemini-flash-lite-latest'
        ];

        for (let i = 0; i < geminiModels.length; i++) {
          const model = geminiModels[i];
          try {
            const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + geminiKey;

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
              lastError = (data && data.error && data.error.message) || ('Gemini HTTP ' + response.status);
              continue;
            }

            let text = '';
            if (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text) {
              text = data.candidates[0].content.parts[0].text;
            }

            if (!text) {
              lastError = 'Gemini empty response';
              continue;
            }

            const trimmedText = text.trim();
            const allCovered = /^ALL_TOPICS_COVERED\s*$/i.test(trimmedText);

            return new Response(JSON.stringify({
              success: true,
              partNumber: partNumber,
              model: 'gemini:' + model,
              text: allCovered ? '' : trimmedText,
              allCovered: allCovered
            }), {
              status: 200,
              headers: Object.assign({}, corsHeaders, { 'Content-Type': 'application/json' })
            });

          } catch (err) {
            lastError = 'Gemini: ' + err.message;
            continue;
          }
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