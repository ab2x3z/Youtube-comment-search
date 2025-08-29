document.addEventListener('DOMContentLoaded', () => {
    // --- UI ELEMENTS ---
    const statusEl = document.getElementById('status');
    const searchInput = document.getElementById('searchInput');
    const resultsEl = document.getElementById('results');

    let allComments = [];

    // --- Main Logic ---
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        const url = new URL(activeTab.url);

        if (url.hostname === "www.youtube.com" && url.pathname === "/watch") {
            const videoId = url.searchParams.get("v");
            if (videoId) {
                fetchAllCommentsWithReplies(videoId);
            } else {
                statusEl.textContent = 'Could not find a video ID on this page.';
            }
        } else {
            statusEl.textContent = 'This extension only works on YouTube video pages.';
        }
    });

    // --- API Fetching Logic ---
    async function fetchAllCommentsWithReplies(videoId) {
        if (!API_KEY || API_KEY === 'YOUR_API_KEY_GOES_HERE') {
            statusEl.textContent = 'ERROR: API Key is not set in popup.js';
            return;
        }

        let comments = [];
        let nextPageToken = null;
        let commentCount = 0;
        statusEl.textContent = 'Fetching comments...';

        try {
            // Loop for top-level comments
            do {
                const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&key=${API_KEY}&maxResults=100&pageToken=${nextPageToken || ''}`;
                const response = await fetch(apiUrl);

                if (!response.ok) {
                    const errorData = await response.json();
                    const errorMessage = errorData.error.message || 'An unknown API error occurred.';
                    throw new Error(errorMessage);
                }

                const data = await response.json();

                // Process each comment thread
                for (const item of data.items) {
                    const topLevelComment = item.snippet.topLevelComment.snippet;
                    comments.push({
                        author: topLevelComment.authorDisplayName,
                        text: topLevelComment.textDisplay
                    });
                    commentCount++;

                    // --- Check for and fetch replies ---
                    if (item.replies) {
                        let replyNextPageToken = null;
                        for (const reply of item.replies.comments) {
                            comments.push({
                                author: reply.snippet.authorDisplayName,
                                text: reply.snippet.textDisplay
                            });
                            commentCount++;
                        }
                    }
                    statusEl.textContent = `Processing... Found ${commentCount} comments.`;
                }

                nextPageToken = data.nextPageToken;

            } while (nextPageToken);

            allComments = comments;
            statusEl.textContent = `Ready! Found ${allComments.length} comments.`;
            searchInput.disabled = false;
            searchInput.focus();
        } catch (error) {
            statusEl.textContent = `Error: ${error.message}`;
            console.error(error);
        }
    }

    // --- Search  ---
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