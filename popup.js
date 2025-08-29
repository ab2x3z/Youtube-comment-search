document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const statusEl = document.getElementById('status');
    const searchInput = document.getElementById('searchInput');
    const resultsEl = document.getElementById('results');
    const deepScanButton = document.getElementById('deepScanButton');

    let allComments = [];
    let videoId = null;

    // --- Main Logic ---
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        const url = new URL(activeTab.url);

        if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
            videoId = url.searchParams.get("v");
            if (videoId) {
                fetchComments(videoId, false);
            } else {
                statusEl.textContent = 'Could not find a video ID on this page.';
            }
        } else {
            statusEl.textContent = 'This extension only works on YouTube video pages.';
        }
    });

    // --- Event Listener for Deep Scan Button ---
    deepScanButton.addEventListener('click', () => {
        if (videoId) {
            resultsEl.innerHTML = '';
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
        if (!API_KEY || API_KEY === 'YOUR_API_KEY_GOES_HERE') {
            statusEl.textContent = 'ERROR: API Key is not set in config.js';
            return;
        }

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

        } catch (error) {
            statusEl.textContent = `Error: ${error.message}`;
            console.error(error);
        }
    }

    // --- Search ---
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase();
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