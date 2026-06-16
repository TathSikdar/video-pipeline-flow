import { CustomDropdown } from './CustomDropdown';

export function InputForm({
  videoUrl,
  setVideoUrl,
  isFetchingInfo,
  infoFetched,
  title,
  setTitle,
  originalTitle,
  availableResolutions,
  resolution,
  setResolution,
  skipUpload,
  setSkipUpload,
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
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-gray-800/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all pr-12"
            />
            {isFetchingInfo && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>

        {infoFetched && (
          <div className="space-y-4 animate-fade-in-up" style={{ animationDuration: '0.3s' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="title-input" className="block text-sm font-medium text-gray-300 mb-2">
                  Reupload Title (Optional)
                </label>
                <input
                  id="title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={originalTitle ? `TubeSync - ${originalTitle}` : "What should we name this video?"}
                  className="w-full bg-gray-800/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                />
              </div>

              <div>
                <label htmlFor="resolution-input" className="block text-sm font-medium text-gray-300 mb-2">
                  Video Quality
                </label>
                <CustomDropdown
                  value={resolution}
                  onChange={setResolution}
                  options={availableResolutions}
                />

                <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-gray-800/40 border border-gray-700/50 transition-colors hover:bg-gray-800/60">
                  <span className="text-sm font-medium text-gray-300">Skip YouTube Upload (Test Mode)</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipUpload}
                      onChange={(e) => setSkipUpload(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                  </label>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="description-input" className="block text-sm font-medium text-gray-300 mb-2">
                Reupload Description (Optional)
              </label>
              <textarea
                id="description-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
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
        Sync Video
      </button>
    </div>
  );
}
