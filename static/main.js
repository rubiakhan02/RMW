// ================= CHAT CONFIGURATION =================
let chatConfig = {};
let contactInfo = {};
let formSchema = {};
const developerContext = (window.RMW_DEV_CONTEXT || "").trim();
const leadApiBase = '/v1/submit-lead';
const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognition = null;
let isListening = false;
let finalTranscript = '';
let interimTranscript = '';
let shouldSendAfterListening = false;

function getTimeoutMessage() {
    const phone = contactInfo.phone || '+91-7290002168';
    return `\n\nTaking a bit longer than usual. If this is the first message, the server may be waking up.\nYou can wait a few seconds, or contact us directly:\n📞 ${phone}`;
}

function scrollChatToBottom() {
    const chatBox = document.getElementById('chat-box');
    if (chatBox) {
        chatBox.scrollTop = chatBox.scrollHeight;
    }
}

async function loadChatConfig() {
    try {
        // Load chat configuration from backend
        const configRes = await fetch('/v1/chat-config');
        chatConfig = await configRes.json();
        
        // Load contact info from backend
        const contactRes = await fetch('/v1/contact-info');
        contactInfo = await contactRes.json();
        
        // Load form schema from backend
        const formRes = await fetch(`${leadApiBase}/form-schema`);
        formSchema = await formRes.json();
        
        console.log('✅ Configuration loaded', { chatConfig, contactInfo, formSchema });
    } catch (err) {
        console.error('❌ Configuration loading failed:', err);
        // Use defaults
        chatConfig = { timeout_ms: 20000, typing_indicator_delay: 500, max_history: 6 };
        contactInfo = { phone: '+91-7290002168', email: 'info@ritzmediaworld.com' };
    }
}

// Load config on script load
loadChatConfig();

// ================= CHAT STATE =================
let chatHistory = [];

function getVoiceButtonIconMarkup(isActive = false) {
    return `
        <span class="voice-input-icon" aria-hidden="true">
            <svg class="voice-icon-svg${isActive ? ' active' : ''}" viewBox="0 0 64 64" focusable="false">
                <defs>
                    <linearGradient id="voiceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#ffd2f3"></stop>
                        <stop offset="55%" stop-color="#ff61cf"></stop>
                        <stop offset="100%" stop-color="#c2188f"></stop>
                    </linearGradient>
                    <filter id="voiceGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.4" result="blur"></feGaussianBlur>
                        <feMerge>
                            <feMergeNode in="blur"></feMergeNode>
                            <feMergeNode in="SourceGraphic"></feMergeNode>
                        </feMerge>
                    </filter>
                </defs>
                <g filter="url(#voiceGlow)">
                    <rect x="24" y="8" width="16" height="28" rx="8" fill="url(#voiceGradient)" stroke="#9c136f" stroke-width="2"></rect>
                    <path d="M18 31v3c0 7.7 6.3 14 14 14s14-6.3 14-14v-3" fill="none" stroke="#ff7ad9" stroke-width="5" stroke-linecap="round"></path>
                    <path d="M18 31v3c0 7.7 6.3 14 14 14s14-6.3 14-14v-3" fill="none" stroke="#9c136f" stroke-width="2" stroke-linecap="round"></path>
                    <path d="M32 48v7" fill="none" stroke="#9c136f" stroke-width="3" stroke-linecap="round"></path>
                    <rect x="22" y="55" width="20" height="5" rx="2.5" fill="url(#voiceGradient)" stroke="#9c136f" stroke-width="2"></rect>
                    <circle cx="28" cy="16" r="3" fill="#fff3fb"></circle>
                    <path d="M26 22c0-3 1.8-6 4.5-7.8" fill="none" stroke="#fff3fb" stroke-width="3" stroke-linecap="round"></path>
                    ${isActive ? '<circle cx="50" cy="14" r="4" fill="#ffd84f"></circle>' : ''}
                </g>
            </svg>
        </span>
    `;
}

function updateVoiceInputField() {
    const input = document.getElementById('user-input');
    if (!input) return;

    const spokenText = `${finalTranscript} ${interimTranscript}`.trim();
    input.value = spokenText;

    if (isListening) {
        input.placeholder = spokenText ? 'Listening...' : 'Listening, speak now...';
    } else {
        input.placeholder = 'Ask me anything...';
    }
}

function resetVoiceTranscriptState() {
    finalTranscript = '';
    interimTranscript = '';
    shouldSendAfterListening = false;
    updateVoiceInputField();
}

function setVoiceButtonState(listening) {
    const voiceButton = document.getElementById('voice-input-btn');
    if (!voiceButton) return;

    voiceButton.classList.toggle('is-listening', listening);
    voiceButton.setAttribute('aria-pressed', listening ? 'true' : 'false');
    voiceButton.title = listening ? 'Listening...' : 'Speak your message';
    voiceButton.innerHTML = getVoiceButtonIconMarkup(listening);
}

function initializeVoiceInput() {
    const voiceButton = document.getElementById('voice-input-btn');
    const input = document.getElementById('user-input');

    if (!voiceButton || !input) return;

    if (!SpeechRecognitionApi) {
        voiceButton.disabled = true;
        voiceButton.title = 'Voice input is not supported in this browser';
        return;
    }

    speechRecognition = new SpeechRecognitionApi();
    speechRecognition.lang = 'en-US';
    speechRecognition.interimResults = true;
    speechRecognition.continuous = true;
    speechRecognition.maxAlternatives = 1;

    speechRecognition.addEventListener('start', () => {
        isListening = true;
        finalTranscript = '';
        interimTranscript = '';
        setVoiceButtonState(true);
        updateVoiceInputField();
    });

    speechRecognition.addEventListener('end', () => {
        isListening = false;
        setVoiceButtonState(false);

        const transcriptToSend = `${finalTranscript} ${interimTranscript}`.trim();
        updateVoiceInputField();

        if (shouldSendAfterListening && transcriptToSend) {
            shouldSendAfterListening = false;
            sendMessage();
            resetVoiceTranscriptState();
            return;
        }

        shouldSendAfterListening = false;
    });

    speechRecognition.addEventListener('result', (event) => {
        interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const transcript = result?.[0]?.transcript?.trim();
            if (!transcript) continue;

            if (result.isFinal) {
                finalTranscript = `${finalTranscript} ${transcript}`.trim();
            } else {
                interimTranscript = `${interimTranscript} ${transcript}`.trim();
            }
        }

        updateVoiceInputField();
    });

    speechRecognition.addEventListener('error', (event) => {
        console.error('Voice input error:', event.error);
        shouldSendAfterListening = false;
    });

    voiceButton.addEventListener('click', () => {
        if (isListening) {
            shouldSendAfterListening = true;
            speechRecognition.stop();
            return;
        }

        try {
            resetVoiceTranscriptState();
            speechRecognition.start();
        } catch (err) {
            console.error('Unable to start voice input:', err);
        }
    });
}

// Streaming version of sendMessage
async function sendMessage() {
    const input = document.getElementById('user-input');
    const message = input.value.trim();
    if (!message) return;

    addMessage('You', message);
    input.value = '';

    // Create a message element for streaming response
    const botMessageDiv = document.createElement('div');
    botMessageDiv.className = 'message bot-message';
    //botMessageDiv.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    const chatBox = document.getElementById('chat-box');
    chatBox.appendChild(botMessageDiv);
    scrollChatToBottom();

    const controller = new AbortController();
    
    const timeoutId = setTimeout(() => {
        controller.abort();
        const timeoutMessage = getTimeoutMessage();
        botMessageDiv.textContent = botMessageDiv.textContent
            ? `${botMessageDiv.textContent}${timeoutMessage}`
            : timeoutMessage.trim();
    }, chatConfig.timeout_ms || 20000);

    
    try {
        // Call streaming endpoint
        const res = await fetch('/v1/message/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message,
                session_id: null,
                developer_context: developerContext,
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullAnswer = '';
        let sseBuffer = '';
        let finalRecorded = false;
      

       

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                // Flush any buffered content on stream end.
                sseBuffer += decoder.decode();
                break;
            }

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.chunk) {
                             // Append chunk to the message
                            fullAnswer += data.chunk;
                            botMessageDiv.textContent = fullAnswer;
                            scrollChatToBottom();
                        }
                        
                        if (data.final) {
                            // Final answer received
                            fullAnswer = data.answer || fullAnswer;
                            botMessageDiv.textContent = fullAnswer;
                            scrollChatToBottom();
                            
                            // Add to chat history
                            if (!finalRecorded) {
                                chatHistory.push({ role: 'assistant', content: fullAnswer });
                                if (chatHistory.length > 6) chatHistory.shift();
                                finalRecorded = true;
                            }
                        }
                        
                        if (data.error) {
                            botMessageDiv.textContent = `⚠️ ${data.error}`;
                        }
                    } catch (e) {
                        console.log('Parse error:', e);
                    }
                }
            }
        }

        // Parse any final buffered SSE line if present.
        const tailLine = sseBuffer.trim();
        if (tailLine.startsWith('data: ')) {
            try {
                const data = JSON.parse(tailLine.slice(6));
                if (data.chunk) {
                      // Append chunk to the message
                            fullAnswer += data.chunk;
                            botMessageDiv.textContent = fullAnswer;
                            scrollChatToBottom();
                }
                if (data.final) {
                    fullAnswer = data.answer || fullAnswer;
                    botMessageDiv.textContent = fullAnswer;
                    scrollChatToBottom();
                    if (!finalRecorded) {
                        chatHistory.push({ role: 'assistant', content: fullAnswer });
                        if (chatHistory.length > 6) chatHistory.shift();
                        finalRecorded = true;
                    }
                }
            } catch (e) {
                console.log('Tail parse error:', e);
            }
        }

    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name !== 'AbortError') {
            console.error('❌ Chat Error:', err);
            botMessageDiv.textContent = `⚠️ Something went wrong. Please try again or contact us:\n📞 ${contactInfo.phone}\n📧 ${contactInfo.email}`;
        }
    }
}


// ================= MESSAGE UI =================
function addMessage(sender, text, isTyping = false) {
    const chatBox = document.getElementById('chat-box');
    const msg = document.createElement('div');
    msg.className = 'message ' + (sender === 'You' ? 'user-message' : 'bot-message');

    if (isTyping) {
        msg.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
    } else {
        msg.textContent = text;

        if (!isTyping && text) {
            chatHistory.push({ role: sender === 'You' ? 'user' : 'assistant', content: text });
            if (chatHistory.length > 6) chatHistory.shift();
        }

        // Do not display source metadata in the chat UI.
    }

    chatBox.appendChild(msg);
    scrollChatToBottom();
    return msg;
}

// ================= ENQUIRE BUTTON =================
function addEnquireButton() {
    const chatBox = document.getElementById('chat-box');

    const wrapper = document.createElement('div');
    wrapper.className = 'message bot-message';

    const btn = document.createElement('button');
    btn.innerText = "Enquire";
    btn.className = "enquire-btn";

    btn.onclick = () => {
        openLeadModal();
        leadShown = true;
    };

    wrapper.appendChild(btn);
    chatBox.appendChild(wrapper);
    scrollChatToBottom();
}

// ================= LEAD FORM INLINE =================
function openLeadModal() {
    const existingForm = document.getElementById('inline-lead-form');
    if (existingForm) {
        existingForm.scrollIntoView({ behavior: 'smooth' });
        return;
    }

    const chatBox = document.getElementById('chat-box');
    const formWrapper = document.createElement('div');
    formWrapper.className = 'message bot-message inline-lead-form-wrapper';
    formWrapper.id = 'inline-lead-form';

    // Build form dynamically from schema. If schema isn't loaded yet,
    // keep a safe fallback so the service dropdown is always available.
    const fallbackServices = [
        "Digital Marketing",
        "Creative Services",
        "Print Advertising",
        "Radio Advertising",
        "Content Marketing",
        "Web Development",
        "Celebrity Endorsements",
        "Influencer Marketing"
    ];
    const safeSchema = (formSchema && Array.isArray(formSchema.fields) && formSchema.fields.length > 0)
        ? formSchema
        : {
            fields: [
                { id: "name", type: "text", placeholder: "Name *" },
                { id: "phone", type: "tel", placeholder: "Phone Number *" },
                { id: "email", type: "email", placeholder: "Email Address *" },
                { id: "service", type: "select", placeholder: "Select Service *", options: fallbackServices },
                { id: "message", type: "textarea", placeholder: "Message (optional)" }
            ]
        };

    let formHTML = '<div class="lead-content"><h3>Share your details</h3>';
    
    if (safeSchema.fields && Array.isArray(safeSchema.fields) && safeSchema.fields.length > 0) {
        safeSchema.fields.forEach(field => {
            if (field.type === 'select') {
                formHTML += `
                    <select id="lead${field.id.charAt(0).toUpperCase() + field.id.slice(1)}" 
                            data-field="${field.id}" 
                            class="lead-input">
                        <option value="">${field.placeholder}</option>
                        ${(field.options || []).map(opt => `<option>${opt}</option>`).join('')}
                    </select>`;
            } else if (field.type === 'textarea') {
                formHTML += `<textarea id="lead${field.id.charAt(0).toUpperCase() + field.id.slice(1)}" 
                                        data-field="${field.id}" 
                                        class="lead-input"
                                        placeholder="${field.placeholder}"></textarea>`;
            } else {
                formHTML += `<input id="lead${field.id.charAt(0).toUpperCase() + field.id.slice(1)}" 
                                     type="${field.type}" 
                                     data-field="${field.id}" 
                                     class="lead-input"
                                     placeholder="${field.placeholder}" />`;
            }
        });
    }
    
    formHTML += `
        <p id="leadError" class="lead-error"></p>
        <div class="lead-buttons">
            <button onclick="submitLead()">Submit</button>
            <button onclick="closeLeadModal()">Cancel</button>
        </div>
        </div>
    `;

    formWrapper.innerHTML = formHTML;
    chatBox.appendChild(formWrapper);
    scrollChatToBottom();

    // Add inline validation listeners
    if (safeSchema.fields && Array.isArray(safeSchema.fields)) {
        safeSchema.fields.forEach(field => {
            const fieldId = `lead${field.id.charAt(0).toUpperCase() + field.id.slice(1)}`;
            const element = document.getElementById(fieldId);
            if (element) {
                element.addEventListener('blur', () => validateField(field.id));
            }
        });
    }
}

function closeLeadModal() {
    const inlineForm = document.getElementById('inline-lead-form');
    if (inlineForm) inlineForm.remove();
}

// ================= VALIDATION WITH BACKEND =================
async function validateField(fieldId) {
    const fieldMap = {
        'name': 'leadName',
        'phone': 'leadPhone',
        'email': 'leadEmail',
        'service': 'leadService',
        'message': 'leadMsg'
    };

    const inputElement = document.getElementById(fieldMap[fieldId]);
    if (!inputElement) return;

    const value = inputElement.value.trim();
    if (!value) return; // Skip empty optional fields

    try {
        const validationData = {};
        validationData[fieldId] = value;

        const res = await fetch(`${leadApiBase}/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(validationData)
        });

        const result = await res.json();
        const errorBox = document.getElementById('leadError');

        if (!result.valid && result.errors[fieldId]) {
            errorBox.innerText = result.errors[fieldId];
            inputElement.style.borderColor = 'red';
        } else {
            inputElement.style.borderColor = '';
        }
    } catch (err) {
        console.error('❌ Validation Error:', err);
    }
}

async function validateAllFields() {
    const errors = {};

    try {
        const name = document.getElementById('leadName')?.value.trim() || '';
        const phone = document.getElementById('leadPhone')?.value.trim() || '';
        const email = document.getElementById('leadEmail')?.value.trim() || '';
        const service = document.getElementById('leadService')?.value || '';

        // Validate all at once
        const res = await fetch(`${leadApiBase}/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name || undefined,
                phone: phone || undefined,
                email: email || undefined,
                service: service || undefined
            })
        });

        const result = await res.json();
        return result;
    } catch (err) {
        console.error('❌ Validation Error:', err);
        return { valid: false, errors: { general: 'Validation failed' } };
    }
}

// ================= SUBMIT LEAD =================
async function submitLead() {
    const errorBox = document.getElementById("leadError");
    
    // Validate using backend
    const validation = await validateAllFields();

    if (!validation.valid) {
        const firstError = Object.values(validation.errors)[0];
        errorBox.innerText = firstError || "Please check the form";
        return;
    }

    errorBox.innerText = "";

    const name = document.getElementById("leadName").value.trim();
    const phone = document.getElementById("leadPhone").value.trim();
    const email = document.getElementById("leadEmail").value.trim();
    const service = document.getElementById("leadService").value;
    const message = document.getElementById("leadMsg")?.value.trim() || "";

    try {
        const response = await fetch(leadApiBase, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, phone, email, service, message })
        });

        const result = await response.json();

        if (result.success) {
            const nameEl = document.getElementById("leadName");
            const phoneEl = document.getElementById("leadPhone");
            const emailEl = document.getElementById("leadEmail");
            const serviceEl = document.getElementById("leadService");
            const msgEl = document.getElementById("leadMsg");

            if (nameEl) nameEl.value = "";
            if (phoneEl) phoneEl.value = "";
            if (emailEl) emailEl.value = "";
            if (serviceEl) serviceEl.value = "";
            if (msgEl) msgEl.value = "";

            closeLeadModal();
            addMessage("Bot", "✅ Thanks! Our team will reach out soon 🙂");
        } else {
            errorBox.innerText = result.message || "Submission failed";
        }
    } catch (err) {
        console.error(err);
        errorBox.innerText = "Network error — please try again.";
    }
}

// ================= ENTER KEY =================
document.getElementById('user-input')
    .addEventListener('keypress', function (e) {
        if (e.key === 'Enter') sendMessage();
    });

// ================= AUTO WELCOME =================
window.addEventListener("load", async () => {
    initializeVoiceInput();
    try {
        // Load welcome message from backend
        const welcomeRes = await fetch('/v1/welcome');
        const welcomeData = await welcomeRes.json();
        
        if (welcomeData.show_typing) {
            const typing = addMessage('Bot', '', true);
            setTimeout(() => {
                typing.remove();
                addMessage('Bot', welcomeData.message);
            }, welcomeData.delay);
        } else {
            addMessage('Bot', welcomeData.message);
        }
    } catch (err) {
        console.error('❌ Welcome message error:', err);
        // Fallback welcome message
        const typing = addMessage('Bot', '', true);
        setTimeout(() => {
            typing.remove();
            addMessage('Bot', `Hello 👋 I'm Ruby.\nWelcome to Ritz Media World.\n\nIf you're exploring our services, campaigns, or capabilities,\nI'm here to help you 😊`);
        }, 800);
    }
});
