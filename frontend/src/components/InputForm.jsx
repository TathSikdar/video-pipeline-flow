import { CustomDropdown } from './CustomDropdown';

export function InputForm({
  videoUrl,
  setVideoUrl,
  urlError,
  isFetchingInfo,
  infoFetched,
  title,
  setTitle,
  originalTitle,
  availableResolutions,
  resolution,
  setResolution,
  reupload,
  setReupload,
  description,
  setDescription,
  isConnected,
  addToQueue
}) {
  return (
    <div className="glass-card p-8 mb-8 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
      <div className="mb-6 space-y-4">
        <div>
          <label htmlFor="video-url-input" className="block text-sm font-medium text-gray-300 mb-2">
            YouTube URL
          </label>
          <div className="relative">
            <input
              id="video-url-input"
              type="text"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onPaste={(e) => {
                const pastedText = e.clipboardData.getData('text');
                const match = pastedText.match(/(?:v=|\/v\/|youtu\.be\/|shorts\/|embed\/|^)([a-zA-Z0-9_-]{11})/);
                if (match) {
                  e.preventDefault();
                  setVideoUrl(`https://www.youtube.com/watch?v=${match[1]}`);
                }
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-gray-800/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all pr-12"
            />
            {isFetchingInfo && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>
          {urlError && (
            <p className="mt-2 text-sm text-rose-400 font-medium animate-fade-in-up">{urlError}</p>
          )}
        </div>

        {infoFetched && (
          <div className="space-y-4 animate-fade-in-up" style={{ animationDuration: '0.3s' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label htmlFor="title-input" className="block text-sm font-medium text-gray-300">
                    Reupload Title (Optional)
                  </label>
                  <span className={`text-xs ${title.length >= 100 ? 'text-rose-400 font-medium' : 'text-gray-500'}`}>
                    {title.length}/100
                  </span>
                </div>
                <input
                  id="title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  placeholder={originalTitle ? `TransferTube | ${originalTitle}` : "What should we name this video?"}
                  className="w-full bg-gray-800/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
              </div>

              <div className="flex gap-4">
                <div className="flex-1">
                  <label htmlFor="resolution-input" className="block text-sm font-medium text-gray-300 mb-2">
                    Video Quality
                  </label>
                  <CustomDropdown
                    value={resolution}
                    onChange={setResolution}
                    options={availableResolutions}
                  />
                </div>

                <div className="flex-shrink-0">
                  <label className="block text-center text-sm font-medium text-gray-300 mb-2">
                    Reupload
                  </label>
                  <div className="flex items-center justify-center h-[50px]">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reupload}
                        onChange={(e) => setReupload(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <label htmlFor="description-input" className="block text-sm font-medium text-gray-300">
                  Reupload Description (Optional)
                </label>
                <span className={`text-xs ${description.length >= 5000 ? 'text-rose-400 font-medium' : 'text-gray-500'}`}>
                  {description.length}/5000
                </span>
              </div>
              <textarea
                id="description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={5000}
                placeholder="Add a description for the uploaded video..."
                rows={3}
                className="w-full bg-gray-800/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all resize-none"
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={addToQueue}
        disabled={!isConnected || !infoFetched || isFetchingInfo}
        className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-cyan-500/25 active:scale-[0.99]"
      >
        <div className="relative inline-flex w-full items-center justify-center">
          <span className="invisible">Download & Reupload Video</span>
          <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${reupload ? 'opacity-100' : 'opacity-0'}`}>
            Download & Reupload Video
          </span>
          <span className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${!reupload ? 'opacity-100' : 'opacity-0'}`}>
            Download Video
          </span>
        </div>
      </button>
    </div>
  );
}
