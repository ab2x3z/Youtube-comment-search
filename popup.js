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

    // --- Load from session storage or fetch ---
    function loadCommentsAndState(currentVideoId) {
        chrome.storage.session.get(['cachedVideoId', 'cachedComments', 'isDeepScanComplete', 'lastSearchQuery'], (data) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                fetchComments(currentVideoId, false); // Fallback to fetching
                return;
            }

            // Check if we have a valid cache for the CURRENT video
            if (data.cachedVideoId === currentVideoId && data.cachedComments && data.cachedComments.length > 0) {
                console.log("Loading comments from session cache.");
                allComments = data.cachedComments;

                // Restore UI state from cache
                statusEl.textContent = `Ready! Found ${allComments.length} comments.`;
                searchInput.disabled = false;
                deepScanButton.disabled = false;
                searchInput.focus();

                if (data.isDeepScanComplete) {
                    deepScanButton.textContent = "Scan Complete";
                    deepScanButton.disabled = true;
                }
                
                // Restore search query and results
                if (data.lastSearchQuery) {
                    searchInput.value = data.lastSearchQuery;
                    // Trigger the 'input' event to perform the search
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                }
            } else {
                // No cache for this video, so fetch anew
                console.log("No valid cache. Fetching comments.");
                fetchComments(currentVideoId, false);
            }
        });
    }

    // --- Event Listener for Deep Scan Button ---
    deepScanButton.addEventListener('click', () => {
        if (videoId) {
            resultsEl.innerHTML = '';
             // Clear any previous search query as we are starting a new scan
            searchInput.value = '';
            chrome.storage.session.set({ lastSearchQuery: '' });
            fetchComments(videoId, true);
        }
    });

    // --- Helper function to fetch replies for a single comment ---
    async function fetchReplies(parentId) {
        let replies = [];
        let nextPageToken = null;

        do {
            const apiUrl = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
            const response = await fetch(apiUrl);
            if (!response.ok) break;

            const data = await response.json();
            const fetchedReplies = data.items.map(item => ({
                author: item.snippet.authorDisplayName,
                text: item.snippet.textDisplay
            }));
            replies.push(...fetchedReplies);
            nextPageToken = data.nextPageToken;

        } while (nextPageToken);

        return replies;
    }

    // --- API Fetching Logic ---
    async function fetchComments(videoId, isDeepScan) {
        // Reset UI for fetching
        allComments = [];
        searchInput.disabled = true;
        deepScanButton.disabled = true;
        statusEl.textContent = isDeepScan ? 'Performing deep scan...' : 'Fetching comments...';

        let nextPageToken = null;
        let commentCount = 0;

        try {
            // Main loop for top-level comment threads
            do {
                const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
                const response = await fetch(apiUrl);

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error.message || 'An API error occurred.');
                }

                const data = await response.json();

                // Process each comment thread
                for (const item of data.items) {
                    const topLevelComment = item.snippet.topLevelComment;
                    allComments.push({
                        author: topLevelComment.snippet.authorDisplayName,
                        text: topLevelComment.snippet.textDisplay
                    });
                    commentCount++;

                    // --- Core Logic ---
                    if (isDeepScan && item.snippet.totalReplyCount > 0) {
                        const fetchedReplies = await fetchReplies(topLevelComment.id);
                        allComments.push(...fetchedReplies);
                        commentCount += fetchedReplies.length;
                    } else if (item.replies) {
                        const initialReplies = item.replies.comments.map(reply => ({
                            author: reply.snippet.authorDisplayName,
                            text: reply.snippet.textDisplay
                        }));
                        allComments.push(...initialReplies);
                        commentCount += initialReplies.length;
                    }
                    statusEl.textContent = `Processing... Found ${commentCount} comments.`;
                }

                nextPageToken = data.nextPageToken;

            } while (nextPageToken);

            // Finalize UI
            statusEl.textContent = `Ready! Found ${allComments.length} comments.`;
            searchInput.disabled = false;
            deepScanButton.disabled = false;
            searchInput.focus();
            if (isDeepScan) {
                deepScanButton.textContent = "Scan Complete";
                deepScanButton.disabled = true;
            }

            // --- SAVE TO SESSION STORAGE ---
            chrome.storage.session.set({
                cachedVideoId: videoId,
                cachedComments: allComments,
                isDeepScanComplete: isDeepScan // Save deep scan status
            }, () => {
                console.log('Comments and state saved to session.');
            });

        } catch (error) {
            statusEl.textContent = `Error: ${error.message}`;
            console.error(error);
        }
    }

    // --- Search ---
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
        
        // --- SAVE SEARCH QUERY TO SESSION STORAGE ---
        chrome.storage.session.set({ lastSearchQuery: query });

        resultsEl.innerHTML = '';

        if (query.length < 2) return;

        const filteredComments = allComments.filter(comment =>
            comment.text.toLowerCase().includes(query)
        );

        filteredComments.forEach(comment => {
            const commentDiv = document.createElement('div');
            commentDiv.className = 'comment';
            const authorEl = document.createElement('div');
            authorEl.className = 'comment-author';
            authorEl.textContent = comment.author;
            const textEl = document.createElement('div');
            textEl.className = 'comment-text';
            textEl.innerHTML = comment.text.replace(
                new RegExp(query, 'gi'),
                (match) => `<mark>${match}</mark>`
            );
            commentDiv.appendChild(authorEl);
            commentDiv.appendChild(textEl);
            resultsEl.appendChild(commentDiv);
        });
    });
});