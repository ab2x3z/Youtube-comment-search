importScripts('db.js');

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SCAN') {
        fetchComments(request.videoId, request.apiKey);
    } else if (request.action === 'START_DEEP_SCAN') {
        performDeepScan(request.videoId, request.apiKey);
    }
});

async function fetchComments(videoId, apiKey) {
    // 1. Reset State
    await chrome.storage.session.set({
        status: 'fetching',
        progressCount: 0,
        cachedVideoId: videoId,
        isDeepScanComplete: false,
        errorMessage: ''
    });

    // Clear DB for this video first
    await saveCommentsToDB(videoId, []);

    let commentThreads = [];
    let nextPageToken = null;
    let currentTotalCount = 0;

    try {
        do {
            const apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${videoId}&key=${apiKey}&maxResults=100&pageToken=${nextPageToken || ''}`;
            const response = await fetch(apiUrl);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error.message || 'API Error');
            }

            const data = await response.json();

            for (const item of data.items) {
                const topLevelComment = item.snippet.topLevelComment;
                const initialReplies = item.replies ? item.replies.comments.map(reply => ({
                    id: reply.id, 
                    author: reply.snippet.authorDisplayName, 
                    textHtml: reply.snippet.textDisplay, 
                    authorChannelUrl: reply.snippet.authorChannelUrl
                })) : [];

                currentTotalCount += 1 + initialReplies.length;

                commentThreads.push({
                    topLevelComment: {
                        id: topLevelComment.id, 
                        author: topLevelComment.snippet.authorDisplayName, 
                        textHtml: topLevelComment.snippet.textDisplay, 
                        authorChannelUrl: topLevelComment.snippet.authorChannelUrl
                    },
                    replies: initialReplies,
                    totalReplyCount: item.snippet.totalReplyCount,
                    areAllRepliesLoaded: item.snippet.totalReplyCount <= initialReplies.length
                });
            }

            // Save valid data to DB
            await saveCommentsToDB(videoId, commentThreads);

            // Update status (Lightweight)
            await chrome.storage.session.set({ 
                progressCount: currentTotalCount
            });

            nextPageToken = data.nextPageToken;

        } while (nextPageToken);

        // Done
        await chrome.storage.session.set({ 
            status: 'ready',
            progressCount: currentTotalCount
        });

    } catch (error) {
        await chrome.storage.session.set({ 
            status: 'error',
            errorMessage: error.message
        });
    }
}

async function performDeepScan(videoId, apiKey) {
    await chrome.storage.session.set({ status: 'deep-scanning' });

    // Load existing threads from DB
    let commentThreads = await getCommentsFromDB(videoId);
    
    const threadsToScan = commentThreads.filter(t => !t.areAllRepliesLoaded && t.totalReplyCount > 0);
    let scannedCount = 0;

    try {
        for (const thread of threadsToScan) {
            const allReplies = await fetchReplies(thread.topLevelComment.id, apiKey);
            thread.replies = allReplies;
            thread.areAllRepliesLoaded = true;
            
            scannedCount++;
            
            // Periodically save to DB (every 10 threads to save IO)
            if(scannedCount % 10 === 0) {
                 await saveCommentsToDB(videoId, commentThreads);
            }

            await chrome.storage.session.set({ 
                deepScanProgress: `${scannedCount} of ${threadsToScan.length} threads` 
            });
        }

        // Final Save
        await saveCommentsToDB(videoId, commentThreads);

        const totalCount = commentThreads.reduce((acc, t) => acc + 1 + t.replies.length, 0);

        await chrome.storage.session.set({
            status: 'ready',
            isDeepScanComplete: true,
            progressCount: totalCount
        });

    } catch (error) {
        await chrome.storage.session.set({ 
            status: 'error',
            errorMessage: error.message 
        });
    }
}

async function fetchReplies(parentId, apiKey) {
    let replies = [];
    let nextPageToken = null;
    
    do {
        const apiUrl = `https://www.googleapis.com/youtube/v3/comments?part=snippet&parentId=${parentId}&key=${apiKey}&maxResults=100&textFormat=html&pageToken=${nextPageToken || ''}`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Failed to fetch replies');
        
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

    return replies;
}