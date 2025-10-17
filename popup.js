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
        apiKeyInput.value = '';
        apiKeyInput.focus();
        if (initialMessage) {
            apiKeyStatus.textContent = initialMessage;
            apiKeyStatus.style.color = '#f28b82';
        } else {
            apiKeyStatus.textContent = '';
        }
    }

    saveApiKeyButton.addEventListener('click', () => {
        const potentialApiKey = apiKeyInput.value.trim();
        if (googleApiKeyRegex.test(potentialApiKey)) {
            chrome.storage.local.set({ youtubeApiKey: potentialApiKey }, () => {
                if (chrome.runtime.lastError) {
                    apiKeyStatus.textContent = 'Error saving key.';
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

    function handleInvalidApiKey(errorMessage) {
        chrome.storage.local.remove('youtubeApiKey', () => {
            showApiKeySetup(errorMessage || 'Please enter a valid API key.');
        });
    }
    
    changeApiKeyLink.addEventListener('click', (e) => {
        e.preventDefault();
        handleInvalidApiKey('You may enter a new API key below.');
    });

    // --- Core Application Logic ---
    function initializeApp(API_KEY) {
        let commentThreads = [];
        let videoId = null;

        const tempDiv = document.createElement('div');
        function getPlainText(htmlString) {
            tempDiv.innerHTML = htmlString;
            return tempDiv.textContent || tempDiv.innerText || "";
        }
        
        function getTotalCommentCount(threads) {
            return threads.reduce((total, thread) => total + 1 + thread.replies.length, 0);
        }

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const url = new URL(tabs[0].url);
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
            chrome.storage.session.get(['cachedVideoId', 'cachedCommentThreads', 'isDeepScanComplete', 'lastSearchQuery'], (data) => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError.message);
                    fetchInitialComments(currentVideoId);
                    return;
                }
                if (data.cachedVideoId === currentVideoId && data.cachedCommentThreads && data.cachedCommentThreads.length > 0) {
                    commentThreads = data.cachedCommentThreads;
                    const totalComments = getTotalCommentCount(commentThreads);
                    statusEl.textContent = `Ready! Found ${totalComments} comments.`;
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
        
        async function fetchReplies(parentId) {
            let replies = [];
            let nextPageToken = null;
            try {
                do {
                    const apiUrl = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}&key=${API_KEY}&maxResults=100&textFormat=html&pageToken=${nextPageToken || ''}`;
                    const response = await fetch(apiUrl);
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error.message || 'An API error occurred.');
                    }
                    const data = await response.json();
                    const fetchedReplies = data.items.map(item => ({
                        id: item.id,
                        author: item.snippet.authorDisplayName,
                        textHtml: item.snippet.textDisplay,
                        authorChannelUrl: item.snippet.authorChannelUrl
                    }));
                    replies.push(...fetchedReplies);
                    nextPageToken = data.nextPageToken;
                } while (nextPageToken);
            } catch(error) {
                console.error("Failed to fetch replies:", error);
                throw error;
            }
            return replies;
        }

        deepScanButton.addEventListener('click', () => {
            if (videoId) {
                performDeepScan();
            }
        });

        async function performDeepScan() {
            searchInput.disabled = true;
            deepScanButton.disabled = true;
            statusEl.textContent = 'Performing deep scan...';
            
            const threadsToScan = commentThreads.filter(t => !t.areAllRepliesLoaded && t.totalReplyCount > 0);
            let threadsScanned = 0;
            
            try {
                for (const thread of threadsToScan) {
                    const allReplies = await fetchReplies(thread.topLevelComment.id);
                    thread.replies = allReplies;
                    thread.areAllRepliesLoaded = true;
                    threadsScanned++;
                    statusEl.textContent = `Deep scan: ${threadsScanned} of ${threadsToScan.length} threads scanned...`;
                }

                const totalComments = getTotalCommentCount(commentThreads);
                statusEl.textContent = `Deep scan complete! ${totalComments} total comments loaded.`;
                searchInput.disabled = false;
                deepScanButton.textContent = "Scan Complete";
                searchInput.focus();

                chrome.storage.session.set({
                    cachedVideoId: videoId,
                    cachedCommentThreads: commentThreads,
                    isDeepScanComplete: true
                });

            } catch (error) {
                 const errorMessage = error.message.toLowerCase();
                if (errorMessage.includes('api key not valid') || errorMessage.includes('api key invalid')) {
                    handleInvalidApiKey('The saved API Key is invalid. Please enter a new one.');
                } else {
                    statusEl.textContent = `Error: ${error.message}`;
                    deepScanButton.disabled = false;
                }
            }
        }

        async function fetchInitialComments(videoId) {
            commentThreads = [];
            searchInput.disabled = true;
            deepScanButton.disabled = true;
            statusEl.textContent = 'Fetching comments...';
            let nextPageToken = null;
            let currentTotalCommentCount = 0; // Initialize for dynamic updates
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
                        const initialReplies = item.replies ? item.replies.comments.map(reply => ({
                            id: reply.id, author: reply.snippet.authorDisplayName, textHtml: reply.snippet.textDisplay, authorChannelUrl: reply.snippet.authorChannelUrl
                        })) : [];

                        currentTotalCommentCount++; // For top-level comment
                        currentTotalCommentCount += initialReplies.length; // For initial replies included

                        commentThreads.push({
                            topLevelComment: {
                                id: topLevelComment.id, author: topLevelComment.snippet.authorDisplayName, textHtml: topLevelComment.snippet.textDisplay, authorChannelUrl: topLevelComment.snippet.authorChannelUrl
                            },
                            replies: initialReplies,
                            totalReplyCount: item.snippet.totalReplyCount,
                            areAllRepliesLoaded: item.snippet.totalReplyCount <= initialReplies.length
                        });
                        statusEl.textContent = `Processing... Found ${currentTotalCommentCount} comments.`;
                    }
                    nextPageToken = data.nextPageToken;
                } while (nextPageToken);

                const finalCommentCount = getTotalCommentCount(commentThreads); // Get final accurate count
                statusEl.textContent = `Ready! Found ${finalCommentCount} comments.`;
                searchInput.disabled = false;
                deepScanButton.disabled = false;
                searchInput.focus();

                chrome.storage.session.set({
                    cachedVideoId: videoId,
                    cachedCommentThreads: commentThreads,
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
            const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
            function walk(node) {
                if (node.nodeType === 3) {
                    const text = node.textContent;
                    if (text.match(regex)) {
                        const fragment = document.createDocumentFragment();
                        let lastIndex = 0;
                        text.replace(regex, (match, offset) => {
                            const precedingText = text.substring(lastIndex, offset);
                            if (precedingText) { fragment.appendChild(document.createTextNode(precedingText)); }
                            const mark = document.createElement('mark');
                            mark.textContent = match;
                            fragment.appendChild(mark);
                            lastIndex = offset + match.length;
                        });
                        const remainingText = text.substring(lastIndex);
                        if (remainingText) { fragment.appendChild(document.createTextNode(remainingText)); }
                        node.parentNode.replaceChild(fragment, node);
                    }
                } else if (node.nodeType === 1 && node.childNodes && node.nodeName !== 'MARK') {
                    [...node.childNodes].forEach(walk);
                }
            }
            walk(container);
            return container.innerHTML;
        }

        function createCommentElement(comment, query) {
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
        
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'comment-actions';
        
            // Link to the comment on YouTube
            const goToCommentLink = document.createElement('a');
            goToCommentLink.className = 'go-to-comment-link';
            goToCommentLink.textContent = 'Go to Comment →';
            // The link format is videoId + commentId
            goToCommentLink.href = `https://www.youtube.com/watch?v=${videoId}&lc=${comment.id}`;
            goToCommentLink.target = '_blank';
            goToCommentLink.rel = 'noopener noreferrer';
            
            // We append the link first, so it appears on the left
            actionsDiv.appendChild(goToCommentLink);
        
            commentDiv.appendChild(actionsDiv);
            return { commentDiv, actionsDiv };
        }

        function renderComments(threadsToRender, query) {
            resultsEl.innerHTML = '';
            const fragment = document.createDocumentFragment();
            threadsToRender.forEach(thread => {
                const comment = thread.topLevelComment;
                const { commentDiv, actionsDiv } = createCommentElement(comment, query);

                if (thread.totalReplyCount > 0) {
                    const repliesBtn = document.createElement('button');
                    repliesBtn.className = 'view-replies-btn';
                    repliesBtn.dataset.commentId = comment.id;
                    repliesBtn.textContent = `View ${thread.totalReplyCount} replies`;
                    // Append reply button to the right side of the actions container
                    actionsDiv.appendChild(repliesBtn);
                }
                const repliesContainer = document.createElement('div');
                repliesContainer.className = 'replies-container';
                repliesContainer.id = `replies-${comment.id}`;
                repliesContainer.style.display = 'none';
                commentDiv.appendChild(repliesContainer);
                fragment.appendChild(commentDiv);
            });
            resultsEl.appendChild(fragment);
        }

        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim().toLowerCase();
            chrome.storage.session.set({ lastSearchQuery: searchInput.value });
            if (query.length < 2) {
                resultsEl.innerHTML = '';
                return;
            }
            const filteredThreads = commentThreads.filter(thread => {
                if (getPlainText(thread.topLevelComment.textHtml).toLowerCase().includes(query)) return true;
                for (const reply of thread.replies) {
                    if (getPlainText(reply.textHtml).toLowerCase().includes(query)) return true;
                }
                return false;
            });
            renderComments(filteredThreads, searchInput.value.trim());
        });

        resultsEl.addEventListener('click', async (e) => {
            if (!e.target.matches('.view-replies-btn')) return;
            const button = e.target;
            const commentId = button.dataset.commentId;
            const repliesContainer = document.getElementById(`replies-${commentId}`);
            if (!repliesContainer) return;

            const thread = commentThreads.find(t => t.topLevelComment.id === commentId);
            if (!thread) return;

            const isVisible = repliesContainer.style.display === 'block';
            if (isVisible) {
                repliesContainer.style.display = 'none';
                button.textContent = `View ${thread.totalReplyCount} replies`;
            } else {
                repliesContainer.style.display = 'block';
                button.textContent = 'Hide replies';
                if (!thread.areAllRepliesLoaded) {
                    button.disabled = true;
                    button.textContent = `Loading...`;
                    try {
                        const newReplies = await fetchReplies(commentId);
                        thread.replies = newReplies;
                        thread.areAllRepliesLoaded = true;
                        chrome.storage.session.set({ cachedCommentThreads: commentThreads });

                        const totalComments = getTotalCommentCount(commentThreads);
                        statusEl.textContent = `Ready! Found ${totalComments} comments.`;

                    } catch (err) {
                        button.textContent = 'Error loading replies';
                        button.disabled = false;
                        return;
                    } finally {
                         button.disabled = false;
                         button.textContent = 'Hide replies';
                    }
                }
                repliesContainer.innerHTML = '';
                const query = searchInput.value.trim();
                thread.replies.forEach(reply => {
                    const { commentDiv } = createCommentElement(reply, query);
                    repliesContainer.appendChild(commentDiv);
                });
            }
        });
    }
});