# YouTube Comment Search Extension

A simple Chrome extension to search through all comments on a YouTube video page. It uses the YouTube Data API v3 to fetch all top-level comments and their replies.

## Usage

1.  **Initial Scan (Fast)**: When you first open the extension on a video page, it performs a fast scan. This quickly loads all top-level comments and the most visible replies provided by the API in the initial request. This is the fastest way to search and is sufficient for most videos.

2.  **Deep Scan (Comprehensive)**: If you need to guarantee that every single nested reply is included in the search, click the **Deep Scan** button in the top-right corner.

    **Warning**: The Deep Scan process can be slow on videos with thousands of comments and will use a significantly higher amount of your API quota, as it must make many additional requests to Google's servers.

## Setup

This extension requires a YouTube Data API v3 key to function.

1.  Obtain an API key from the [Google Cloud Console](https://console.cloud.google.com/). You will need to enable the "YouTube Data API v3" for your project.
2.  In the root of this project folder, create a new file named `config.js`.
3.  Add your API key to the file in the following format:
    ```javascript
    const API_KEY = 'YOUR_API_KEY_GOES_HERE';
    ```

## Installation

This extension has not been submitted to the Chrome Web Store and must be loaded manually.

1.  Download or clone this repository to your local machine.
2.  Open Google Chrome and navigate to `chrome://extensions`.
3.  Enable "Developer mode" using the toggle in the top-right corner.
4.  Click the "Load unpacked" button.
5.  Select the project folder where you saved these files.

The extension icon will now appear in your browser's toolbar. Navigate to a YouTube video page and click it to begin.