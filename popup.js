document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const apiKeySetup = document.getElementById('apiKeySetup');
    const mainContent = document.getElementById('mainContent');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyButton = document.getElementById('saveApiKeyButton');
    const apiKeyStatus = document.getElementById('apiKeyStatus');
    const changeApiKeyLink = document.getElementById('changeApiKeyLink');

    const statusEl = document.getElementById('status');
    const searchInput = document.getElementById('searchInput');
    const resultsEl = document.getElementById('results');
    const deepScanButton = document.getElementById('deepScanButton');

    const googleApiKeyRegex = /^AIza[0-9A-Za-z\-_]{35,39}$/;

    let localCommentThreads = [];
    let currentApiKey = '';
    let currentVideoId = '';

    // --- Main Entry Point ---
    chrome.storage.local.get(['youtubeApiKey'], (result) => {
        const apiKey = result.youtubeApiKey;
        if (apiKey && googleApiKeyRegex.test(apiKey)) {
            currentApiKey = apiKey;
            showMainContent();
            initializeUI();
        } else {
            showApiKeySetup();
        }
    });

    function showMainContent() {
        apiKeySetup.style.display = 'none';
        mainContent.style.display = 'block';
    }

    function showApiKeySetup(msg = '') {
        mainContent.style.display = 'none';
        apiKeySetup.style.display = 'block';
        if(msg) apiKeyStatus.textContent = msg;
    }

    saveApiKeyButton.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (googleApiKeyRegex.test(key)) {
            chrome.storage.local.set({ youtubeApiKey: key }, () => {
                apiKeyStatus.textContent = 'Saved. Reloading...';
                setTimeout(() => window.location.reload(), 500);
            });
        } else {
            apiKeyStatus.textContent = 'Invalid format.';
        }
    });

    changeApiKeyLink.addEventListener('click', () => {
        chrome.storage.local.remove('youtubeApiKey', () => showApiKeySetup());
    });

    // --- Application Logic ---
    function initializeUI() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const url = new URL(tabs[0].url);
            if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
                currentVideoId = url.searchParams.get("v");
                syncWithBackground();
            } else {
                statusEl.textContent = 'Only works on YouTube video pages.';
            }
        });
    }

    function syncWithBackground() {
        chrome.storage.session.get(['status', 'cachedVideoId', 'progressCount', 'isDeepScanComplete', 'errorMessage'], async (data) => {
            
            // Case 1: Same video, already fetching or done
            if (data.cachedVideoId === currentVideoId) {
                if (data.status === 'fetching') {
                    setFetchingMode(data.progressCount);
                } else if (data.status === 'deep-scanning') {
                    setDeepScanMode(data.deepScanProgress);
                } else if (data.status === 'ready') {
                    // Load data from DB
                    localCommentThreads = await getCommentsFromDB(currentVideoId);
                    setReadyMode(data.progressCount, data.isDeepScanComplete);
                } else if (data.status === 'error') {
                    statusEl.textContent = `Error: ${data.errorMessage}`;
                } else {
                    // Start fresh if no specific status
                     startFreshScan();
                }
            } else {
                // Case 2: New video or no previous data
                startFreshScan();
            }
        });
    }

    function startFreshScan() {
        setFetchingMode(0);
        chrome.runtime.sendMessage({ 
            action: 'START_SCAN', 
            videoId: currentVideoId, 
            apiKey: currentApiKey 
        });
    }

    // Listen for live updates
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session') {
            if (changes.status && changes.status.newValue === 'ready') {
                // When fetch finishes, load data from DB
                chrome.storage.session.get(['progressCount', 'isDeepScanComplete'], async (d) => {
                    localCommentThreads = await getCommentsFromDB(currentVideoId);
                    setReadyMode(d.progressCount, d.isDeepScanComplete);
                });
            } else if (changes.progressCount) {
                if (searchInput.disabled) { 
                    statusEl.textContent = `Fetching... Found ${changes.progressCount.newValue} comments.`;
                }
            } else if (changes.deepScanProgress) {
                statusEl.textContent = `Deep scan: ${changes.deepScanProgress.newValue}...`;
            }
        }
    });

    function setFetchingMode(count) {
        statusEl.textContent = `Fetching... Found ${count || 0} comments.`;
        searchInput.disabled = true;
        deepScanButton.disabled = true;
    }

    function setDeepScanMode(progressText) {
        statusEl.textContent = `Deep scan: ${progressText || 'Initializing'}...`;
        searchInput.disabled = true;
        deepScanButton.disabled = true;
    }

    function setReadyMode(count, isDeepComplete) {
        statusEl.textContent = `Ready! Found ${count} comments.`;
        searchInput.disabled = false;
        deepScanButton.disabled = isDeepComplete;
        deepScanButton.textContent = isDeepComplete ? "Scan Complete" : "Deep Scan";
        
        if(searchInput.value) searchInput.dispatchEvent(new Event('input'));
    }

    deepScanButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'START_DEEP_SCAN', videoId: currentVideoId, apiKey: currentApiKey });
    });

    // --- Search Logic ---
    const tempDiv = document.createElement('div');
    function getPlainText(html) {
        tempDiv.innerHTML = html;
        return tempDiv.textContent || "";
    }

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim().toLowerCase();
        if (query.length < 2) {
            resultsEl.innerHTML = '';
            return;
        }
        
        // Use localCommentThreads loaded from DB
        const filtered = localCommentThreads.filter(thread => {
            if (getPlainText(thread.topLevelComment.textHtml).toLowerCase().includes(query)) return true;
            for (const r of thread.replies) {
                if (getPlainText(r.textHtml).toLowerCase().includes(query)) return true;
            }
            return false;
        });
        renderComments(filtered, searchInput.value);
    });

    function renderComments(threads, query) {
        resultsEl.innerHTML = '';
        const frag = document.createDocumentFragment();
        threads.forEach(thread => {
            const { commentDiv, actionsDiv } = createCommentElement(thread.topLevelComment, query);
            
            if(thread.replies.length > 0) {
                const btn = document.createElement('button');
                btn.className = 'view-replies-btn';
                btn.textContent = `View ${thread.replies.length} replies`;
                btn.onclick = () => {
                    let con = commentDiv.querySelector('.replies-container');
                    if(!con) {
                        con = document.createElement('div');
                        con.className = 'replies-container';
                        thread.replies.forEach(r => con.appendChild(createCommentElement(r, query).commentDiv));
                        commentDiv.appendChild(con);
                        btn.textContent = "Hide replies";
                    } else {
                        con.remove();
                        btn.textContent = `View ${thread.replies.length} replies`;
                    }
                };
                actionsDiv.appendChild(btn);
            }
            frag.appendChild(commentDiv);
        });
        resultsEl.appendChild(frag);
    }

    function createCommentElement(comment, query) {
        const commentDiv = document.createElement('div');
        commentDiv.className = 'comment';
        
        const author = document.createElement('a');
        author.className = 'comment-author';
        author.textContent = comment.author;
        author.href = comment.authorChannelUrl;
        author.target = '_blank';
        
        const text = document.createElement('div');
        text.className = 'comment-text';
        text.innerHTML = highlightHtmlString(comment.textHtml, query);

        commentDiv.appendChild(author);
        commentDiv.appendChild(text);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'comment-actions';
        
        const link = document.createElement('a');
        link.className = 'go-to-comment-link';
        link.textContent = 'Go to Comment →';
        link.href = `https://www.youtube.com/watch?v=${currentVideoId}&lc=${comment.id}`;
        link.target = '_blank';
        actionsDiv.appendChild(link);

        commentDiv.appendChild(actionsDiv);
        return { commentDiv, actionsDiv };
    }

    function highlightHtmlString(html, query) {
        if (!query) return html;
        const container = document.createElement('div');
        container.innerHTML = html;
        const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        
        function walk(node) {
            if (node.nodeType === 3) {
                const text = node.textContent;
                if (text.match(regex)) {
                    const fragment = document.createDocumentFragment();
                    let lastIndex = 0;
                    text.replace(regex, (match, offset) => {
                        const precedingText = text.substring(lastIndex, offset);
                        if (precedingText) fragment.appendChild(document.createTextNode(precedingText));
                        const mark = document.createElement('mark');
                        mark.textContent = match;
                        fragment.appendChild(mark);
                        lastIndex = offset + match.length;
                    });
                    const remainingText = text.substring(lastIndex);
                    if (remainingText) fragment.appendChild(document.createTextNode(remainingText));
                    node.parentNode.replaceChild(fragment, node);
                }
            } else if (node.nodeType === 1 && node.childNodes && node.nodeName !== 'MARK') {
                [...node.childNodes].forEach(walk);
            }
        }
        walk(container);
        return container.innerHTML;
    }
});