document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const statusEl = document.getElementById('status');
    const searchInput = document.getElementById('searchInput');
    const resultsEl = document.getElementById('results');
    const deepScanButton = document.getElementById('deepScanButton');
    const googleApiKeyRegex = /^AIza[0-9A-Za-z\-_]{35,39}$/;

    if (typeof API_KEY === 'undefined' || !googleApiKeyRegex.test(API_KEY)) {
        statusEl.textContent = "ERROR: API Key is not set in config.js";
        searchInput.disabled = true;
        deepScanButton.disabled = true;
        return;
    }

    let allComments = [];
    let commentIds = new Set();
    let videoId = null;

    // --- Main Logic ---
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

    // --- Load state from session storage or fetch anew ---
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

    // --- Event Listener for Deep Scan Button ---
    deepScanButton.addEventListener('click', () => {
        if (videoId) {
            performDeepScan(videoId);
        }
    });

    // --- Helper function to fetch all replies for a single comment ---
    async function fetchAllReplies(parentId) {
        let replies = [];
        let nextPageToken = null;

        do {
            const apiUrl = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
            const response = await fetch(apiUrl);
            if (!response.ok) break;

            const data = await response.json();
            const fetchedReplies = data.items.map(item => ({
                id: item.id,
                author: item.snippet.authorDisplayName,
                textHtml: item.snippet.textDisplay // Store the HTML content
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
            statusEl.textContent = `Error: ${error.message}`;
            deepScanButton.disabled = false;
            console.error(error);
        }
    }

    // --- API Fetching Logic for the INITIAL (fast) scan ---
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
                            textHtml: topLevelComment.snippet.textDisplay // Store HTML
                        });
                        commentIds.add(topLevelComment.id);
                        commentCount++;
                    }

                    if (item.replies) {
                        const initialReplies = item.replies.comments.map(reply => ({
                            id: reply.id,
                            author: reply.snippet.authorDisplayName,
                            textHtml: reply.snippet.textDisplay // Store HTML
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
            statusEl.textContent = `Error: ${error.message}`;
            console.error(error);
        }
    }

    function highlightHtmlString(htmlString, query) {
        if (!query) return htmlString;

        // Use a temporary div to parse the string into a DOM structure
        const container = document.createElement('div');
        container.innerHTML = htmlString;
        const regex = new RegExp(query, 'gi');

        // Recursive function to traverse the DOM tree
        function walk(node) {
            // We only care about text nodes (nodeType 3)
            if (node.nodeType === 3) {
                const text = node.textContent;
                const matches = text.match(regex);

                if (matches) {
                    const fragment = document.createDocumentFragment();
                    let lastIndex = 0;

                    text.replace(regex, (match, offset) => {
                        // Append the text before the match
                        const precedingText = text.substring(lastIndex, offset);
                        if (precedingText) {
                            fragment.appendChild(document.createTextNode(precedingText));
                        }
                        // Append the highlighted match
                        const mark = document.createElement('mark');
                        mark.textContent = match;
                        fragment.appendChild(mark);
                        
                        lastIndex = offset + match.length;
                    });
                    
                    // Append any remaining text after the last match
                    const remainingText = text.substring(lastIndex);
                    if (remainingText) {
                        fragment.appendChild(document.createTextNode(remainingText));
                    }

                    // Replace the original text node with our new fragment
                    node.parentNode.replaceChild(fragment, node);
                }
            } 
            // If it's an element node (nodeType 1), walk its children
            else if (node.nodeType === 1 && node.childNodes && node.nodeName !== 'MARK') {
                 // Iterate over a static copy of childNodes, as the list will be modified
                [...node.childNodes].forEach(walk);
            }
        }

        walk(container);
        return container.innerHTML;
    }


    // --- Search ---
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        
        chrome.storage.session.set({ lastSearchQuery: query });

        resultsEl.innerHTML = '';
        if (query.length < 2) return;

        // For searching, convert HTML to plain text to avoid matching inside tags
        const tempDiv = document.createElement('div');
        const filteredComments = allComments.filter(comment => {
            tempDiv.innerHTML = comment.textHtml;
            const plainText = tempDiv.textContent || tempDiv.innerText || "";
            return plainText.toLowerCase().includes(query);
        });

        filteredComments.forEach(comment => {
            const commentDiv = document.createElement('div');
            commentDiv.className = 'comment';
            
            const authorEl = document.createElement('div');
            authorEl.className = 'comment-author';
            authorEl.textContent = comment.author;
            
            const textEl = document.createElement('div');
            textEl.className = 'comment-text';
            textEl.innerHTML = highlightHtmlString(comment.textHtml, query);

            commentDiv.appendChild(authorEl);
            commentDiv.appendChild(textEl);
            resultsEl.appendChild(commentDiv);
        });
    });
});