// A clock that keeps ticking when the app window is covered or minimized (the browser slows down timers and
// animation frames of hidden windows, but not those of a worker). The recorder uses it to pace the video.
setInterval(() => postMessage(0), 4)
