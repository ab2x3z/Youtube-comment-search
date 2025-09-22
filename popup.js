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

    // --- Main Entry Point ---
    chrome.storage.local.get(['youtubeApiKey'], (result) => {
        if (chrome.runtime.lastError) {
            console.error(`Error reading from storage: ${chrome.runtime.lastError.message}`);
            showApiKeySetup('Error accessing browser storage.');
            return;
        }

        const apiKey = result.youtubeApiKey;
        if (apiKey && googleApiKeyRegex.test(apiKey)) {
            showMainContent();
            initializeApp(apiKey);
        } else {
            showApiKeySetup();
        }
    });

    // --- UI View Handlers ---
    function showMainContent() {
        apiKeySetup.style.display = 'none';
        mainContent.style.display = 'block';
    }

    function showApiKeySetup(initialMessage = '') {
        mainContent.style.display = 'none';
        apiKeySetup.style.display = 'block';
        apiKeyInput.value = ''; // Clear previous input
        apiKeyInput.focus();

        if (initialMessage) {
            apiKeyStatus.textContent = initialMessage;
            apiKeyStatus.style.color = '#f28b82'; // red error color
        } else {
            apiKeyStatus.textContent = ''; // Clear any previous messages
        }
    }

    saveApiKeyButton.addEventListener('click', () => {
        const potentialApiKey = apiKeyInput.value.trim();
        if (googleApiKeyRegex.test(potentialApiKey)) {
            chrome.storage.local.set({ youtubeApiKey: potentialApiKey }, () => {
                if (chrome.runtime.lastError) {
                    apiKeyStatus.textContent = 'Error saving key. Please try again.';
                    apiKeyStatus.style.color = '#f28b82';
                    return;
                }
                apiKeyStatus.textContent = 'API Key saved! Reloading...';
                apiKeyStatus.style.color = '#8ab4f8';
                saveApiKeyButton.disabled = true;
                apiKeyInput.disabled = true;
                setTimeout(() => window.location.reload(), 1000);
            });
        } else {
            apiKeyStatus.textContent = 'Invalid API Key format.';
            apiKeyStatus.style.color = '#f28b82';
        }
    });

    // --- Handle API Key Errors and Manual Change Request ---
    function handleInvalidApiKey(errorMessage) {
        // Clear the bad key from storage
        chrome.storage.local.remove('youtubeApiKey', () => {
            // Show the setup screen with a helpful message
            showApiKeySetup(errorMessage || 'Please enter a valid API key.');
        });
    }
    
    changeApiKeyLink.addEventListener('click', (e) => {
        e.preventDefault();
        handleInvalidApiKey('You may enter a new API key below.');
    });

    // --- Core Application Logic ---
    function initializeApp(API_KEY) {
        let allComments = [];
        let commentIds = new Set();
        let videoId = null;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            const url = new URL(activeTab.url);

            if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
                videoId = url.searchParams.get("v");
                if (videoId) {
                    loadCommentsAndState(videoId);
                } else {
                    statusEl.textContent = 'Could not find a video ID on this page.';
                }
            } else {
                statusEl.textContent = 'This extension only works on YouTube video pages.';
            }
        });

        function loadCommentsAndState(currentVideoId) {
            chrome.storage.session.get(['cachedVideoId', 'cachedComments', 'isDeepScanComplete', 'lastSearchQuery'], (data) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    fetchInitialComments(currentVideoId);
                    return;
                }

                if (data.cachedVideoId === currentVideoId && data.cachedComments && data.cachedComments.length > 0) {
                    allComments = data.cachedComments;
                    commentIds = new Set(allComments.map(c => c.id));
                    statusEl.textContent = `Ready! Found ${allComments.length} comments.`;
                    searchInput.disabled = false;
                    deepScanButton.disabled = false;
                    searchInput.focus();

                    if (data.isDeepScanComplete) {
                        deepScanButton.textContent = "Scan Complete";
                        deepScanButton.disabled = true;
                    }
                    
                    if (data.lastSearchQuery) {
                        searchInput.value = data.lastSearchQuery;
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                } else {
                    fetchInitialComments(currentVideoId);
                }
            });
        }

        deepScanButton.addEventListener('click', () => {
            if (videoId) {
                performDeepScan(videoId);
            }
        });
        
        async function fetchAllReplies(parentId) {
            let replies = [];
            let nextPageToken = null;

            do {
                const apiUrl = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
                const response = await fetch(apiUrl);
                if (!response.ok) {
                    // Check for key error even in this helper function
                    if (response.status === 400) {
                         const errorData = await response.json();
                         throw new Error(errorData.error.message || 'An API error occurred.');
                    }
                    break;
                }

                const data = await response.json();
                const fetchedReplies = data.items.map(item => ({
                    id: item.id,
                    author: item.snippet.authorDisplayName,
                    textHtml: item.snippet.textDisplay, // Store the HTML content
                    authorChannelUrl: item.snippet.authorChannelUrl
                }));
                replies.push(...fetchedReplies);
                nextPageToken = data.nextPageToken;

            } while (nextPageToken);

            return replies;
        }
        
        async function performDeepScan(videoId) {
            searchInput.disabled = true;
            deepScanButton.disabled = true;
            statusEl.textContent = 'Performing deep scan...';

            let nextPageToken = null;
            let newCommentsCount = 0;

            try {
                do {
                    const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
                    const response = await fetch(apiUrl);

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error.message || 'An API error occurred.');
                    }
                    
                    const data = await response.json();

                    for (const item of data.items) {
                        if (item.snippet.totalReplyCount > 0) {
                            const topLevelCommentId = item.snippet.topLevelComment.id;
                            const fetchedReplies = await fetchAllReplies(topLevelCommentId);
                            
                            for (const reply of fetchedReplies) {
                                if (!commentIds.has(reply.id)) {
                                    allComments.push(reply);
                                    commentIds.add(reply.id);
                                    newCommentsCount++;
                                }
                            }
                            statusEl.textContent = `Deep scan... Found ${newCommentsCount} new replies. Total: ${allComments.length}`;
                        }
                    }
                    nextPageToken = data.nextPageToken;
                } while (nextPageToken);
                
                statusEl.textContent = `Ready! Found ${allComments.length} total comments.`;
                searchInput.disabled = false;
                deepScanButton.textContent = "Scan Complete";
                searchInput.focus();

                chrome.storage.session.set({
                    cachedVideoId: videoId,
                    cachedComments: allComments,
                    isDeepScanComplete: true
                });

            } catch (error) {
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('api key not valid') || errorMessage.includes('api key invalid')) {
                    handleInvalidApiKey('The saved API Key is invalid. Please enter a new one.');
                } else {
                    statusEl.textContent = `Error: ${error.message}`;
                    deepScanButton.disabled = false; // Re-enable button on other errors
                    console.error(error);
                }
            }
        }

        async function fetchInitialComments(videoId) {
            allComments = [];
            commentIds.clear();
            searchInput.disabled = true;
            deepScanButton.disabled = true;
            statusEl.textContent = 'Fetching comments...';
            let nextPageToken = null;
            let commentCount = 0;

            try {
                do {
                    const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
                    const response = await fetch(apiUrl);

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error.message || 'An API error occurred.');
                    }

                    const data = await response.json();

                    for (const item of data.items) {
                        const topLevelComment = item.snippet.topLevelComment;
                        if (!commentIds.has(topLevelComment.id)) {
                            allComments.push({
                                id: topLevelComment.id,
                                author: topLevelComment.snippet.authorDisplayName,
                                textHtml: topLevelComment.snippet.textDisplay,
                                authorChannelUrl: topLevelComment.snippet.authorChannelUrl
                            });
                            commentIds.add(topLevelComment.id);
                            commentCount++;
                        }
                        if (item.replies) {
                            const initialReplies = item.replies.comments.map(reply => ({
                                id: reply.id,
                                author: reply.snippet.authorDisplayName,
                                textHtml: reply.snippet.textDisplay,
                                authorChannelUrl: reply.snippet.authorChannelUrl
                            }));
                            for (const reply of initialReplies) {
                                if (!commentIds.has(reply.id)) {
                                    allComments.push(reply);
                                    commentIds.add(reply.id);
                                    commentCount++;
                                }
                            }
                        }
                        statusEl.textContent = `Processing... Found ${commentCount} comments.`;
                    }
                    nextPageToken = data.nextPageToken;
                } while (nextPageToken);

                statusEl.textContent = `Ready! Found ${allComments.length} comments.`;
                searchInput.disabled = false;
                deepScanButton.disabled = false;
                searchInput.focus();

                chrome.storage.session.set({
                    cachedVideoId: videoId,
                    cachedComments: allComments,
                    isDeepScanComplete: false
                });

            } catch (error) {
                const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('api key not valid') || errorMessage.includes('api key invalid')) {
                    handleInvalidApiKey('The saved API Key is invalid. Please enter a new one.');
                } else {
                    statusEl.textContent = `Error: ${error.message}`;
                    console.error(error);
                }
            }
        }

        function highlightHtmlString(htmlString, query) {
            if (!query) return htmlString;
            const container = document.createElement('div');
            container.innerHTML = htmlString;
            const regex = new RegExp(query, 'gi');
            function walk(node) {
                if (node.nodeType === 3) {
                    const text = node.textContent;
                    if (text.match(regex)) {
                        const fragment = document.createDocumentFragment();
                        let lastIndex = 0;
                        text.replace(regex, (match, offset) => {
                            const precedingText = text.substring(lastIndex, offset);
                            if (precedingText) {
                                fragment.appendChild(document.createTextNode(precedingText));
                            }
                            const mark = document.createElement('mark');
                            mark.textContent = match;
                            fragment.appendChild(mark);
                            lastIndex = offset + match.length;
                        });
                        const remainingText = text.substring(lastIndex);
                        if (remainingText) {
                            fragment.appendChild(document.createTextNode(remainingText));
                        }
                        node.parentNode.replaceChild(fragment, node);
                    }
                } 
                else if (node.nodeType === 1 && node.childNodes && node.nodeName !== 'MARK') {
                    [...node.childNodes].forEach(walk);
                }
            }
            walk(container);
            return container.innerHTML;
        }

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase();
            chrome.storage.session.set({ lastSearchQuery: query });
            resultsEl.innerHTML = '';
            if (query.length < 2) return;
            const tempDiv = document.createElement('div');
            const filteredComments = allComments.filter(comment => {
                tempDiv.innerHTML = comment.textHtml;
                const plainText = tempDiv.textContent || tempDiv.innerText || "";
                return plainText.toLowerCase().includes(query);
            });
            filteredComments.forEach(comment => {
                const commentDiv = document.createElement('div');
                commentDiv.className = 'comment';
                const authorEl = document.createElement('a');
                authorEl.className = 'comment-author';
                authorEl.textContent = comment.author;
                authorEl.href = comment.authorChannelUrl;
                authorEl.target = '_blank';
                authorEl.rel = 'noopener noreferrer';
                const textEl = document.createElement('div');
                textEl.className = 'comment-text';
                textEl.innerHTML = highlightHtmlString(comment.textHtml, query);
                commentDiv.appendChild(authorEl);
                commentDiv.appendChild(textEl);
                resultsEl.appendChild(commentDiv);
            });
        });
    }
});