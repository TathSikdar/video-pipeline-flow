import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';

// Custom Dropdown Component to match the glassmorphic dark theme
function CustomDropdown({ value, onChange, options }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left bg-gray-800/60 border border-gray-600/50 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all flex justify-between items-center shadow-inner hover:bg-gray-700/50"
      >
        <span>{selectedOption ? selectedOption.label : 'Select...'}</span>
        <svg className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-xl shadow-black/50 overflow-hidden animate-fade-in-up" style={{ animationDuration: '0.2s' }}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-4 py-3 transition-colors ${value === option.value
                ? 'bg-cyan-500/20 text-cyan-400 font-medium border-l-2 border-cyan-500'
                : 'text-gray-300 hover:bg-gray-700/80 border-l-2 border-transparent'
                }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const { messages, isConnected } = useWebSocket('ws://localhost:8000/ws/pipeline');
  const [videoUrl, setVideoUrl] = useState('');
  const [title, setTitle] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState('1080');
  const [skipUpload, setSkipUpload] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [isFetchingInfo, setIsFetchingInfo] = useState(false);
  const [infoFetched, setInfoFetched] = useState(false);
  const [availableResolutions, setAvailableResolutions] = useState([
    { value: '1080', label: '1080p (High Quality)' },
    { value: '720', label: '720p (Standard HD)' },
    { value: '480', label: '480p (Data Saver)' },
  ]);

  const resetToDefaultResolutions = () => {
    setAvailableResolutions([
      { value: '1080', label: '1080p (High Quality)' },
      { value: '720', label: '720p (Standard HD)' },
      { value: '480', label: '480p (Data Saver)' },
    ]);
    setResolution('1080');
  };

  useEffect(() => {
    const url = videoUrl.trim();
    if (!url) {
      setInfoFetched(false);
      setIsFetchingInfo(false);
      return;
    }

    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      setInfoFetched(false);
      return;
    }

    setIsFetchingInfo(true);
    setInfoFetched(false);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/video-info?url=${encodeURIComponent(url)}`);
        const data = await res.json();

        if (data.success && data.resolutions && data.resolutions.length > 0) {
          const newOptions = data.resolutions.map(h => ({
            value: String(h),
            label: `${h}p (${h >= 1080 ? 'High Quality' : h >= 720 ? 'Standard HD' : 'Data Saver'})`
          }));
          setAvailableResolutions(newOptions);
          setResolution(String(data.resolutions[0]));
          setOriginalTitle(data.title || '');
        } else {
          resetToDefaultResolutions();
          setOriginalTitle('');
        }
      } catch (e) {
        resetToDefaultResolutions();
        setOriginalTitle('');
      } finally {
        setIsFetchingInfo(false);
        setInfoFetched(true);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [videoUrl]);

  // Handle incoming websocket messages to update task states
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (!lastMessage || !lastMessage.video_url) return;

    setTasks(prev => prev.map(task => {
      if (task.url === lastMessage.video_url) {
        let updated = { ...task };
        if (lastMessage.type === 'progress') {
          if (lastMessage.stage === 'download') {
            updated.status = 'downloading';
            updated.downloadPercent = Math.max(updated.downloadPercent || 0, lastMessage.percent);
            updated.downloadText = lastMessage.text;
          } else if (lastMessage.stage === 'upload') {
            updated.status = 'uploading';
            updated.uploadPercent = Math.max(updated.uploadPercent || 0, lastMessage.percent);
            updated.uploadText = lastMessage.text;
          }
        } else if (lastMessage.type === 'download_complete') {
          updated.localFile = lastMessage.local_file;
        } else if (lastMessage.type === 'success') {
          updated.status = 'completed';
          updated.watchUrl = lastMessage.url;
          updated.localFile = lastMessage.local_file;
          updated.uploadPercent = 100;
          updated.uploadText = 'Upload Complete';
          updated.downloadPercent = 100;
          updated.downloadText = 'Download Complete';
        } else if (lastMessage.type === 'error') {
          updated.status = 'error';
          updated.errorMessage = lastMessage.text;
        } else if (lastMessage.type === 'info') {
          if (updated.status === 'queued') {
            updated.status = 'preparing';
          }
        }
        return updated;
      }
      return task;
    }));
  }, [lastMessage]);

  const addToQueue = async () => {
    if (!videoUrl.trim()) return;

    const newTask = {
      id: Date.now(),
      url: videoUrl.trim(),
      title: title.trim() || (originalTitle ? `TubeSync - ${originalTitle}` : ''),
      description: description.trim(),
      resolution,
      skipUpload,
      status: 'queued',
      downloadPercent: 0,
      uploadPercent: 0,
      watchUrl: '',
      localFile: '',
    };

    setTasks(prev => [...prev, newTask]);
    setVideoUrl('');
    setTitle('');
    setOriginalTitle('');
    setDescription('');
    setInfoFetched(false);

    try {
      const response = await fetch(
        'http://localhost:8000/api/start-pipeline',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_url: newTask.url,
            title: newTask.title,
            description: newTask.description,
            resolution: newTask.resolution,
            skip_upload: newTask.skipUpload,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to queue: ${response.status}`);
      }
    } catch (err) {
      console.error('Queue error:', err);
      setTasks(prev => prev.map(t =>
        t.id === newTask.id ? { ...t, status: 'error', errorMessage: 'Failed to reach server.' } : t
      ));
    }
  };

  const extractVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/(?:v=|\/v\/|youtu\.be\/|shorts\/|embed\/|^)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const getStatusBadge = (task) => {
    switch (task.status) {
      case 'queued': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-300">Queued</span>;
      case 'preparing': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">Preparing...</span>;
      case 'downloading': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 animate-pulse">Downloading</span>;
      case 'uploading': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 animate-pulse">Uploading</span>;
      case 'completed': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-400">Completed</span>;
      case 'error': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-400">Failed</span>;
      default: return null;
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      {/* Header */}
      <div className="text-center mb-12 animate-fade-in-up">
        <h1 className="text-5xl font-bold tracking-tight pb-2 mb-2 animate-gradient-x bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500">
          TubeSync
        </h1>
        <p className="text-gray-400 text-lg">
          Seamlessly reupload YouTube videos or download them locally.
        </p>
      </div>

      {/* Main Glass Card (Input) */}
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

      {/* Active & Queued Tasks */}
      {tasks.length > 0 && (
        <div className="space-y-4 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <h2 className="text-2xl font-semibold text-white mb-4">Queue</h2>

          {tasks.map((task) => (
            <div key={task.id} className="glass-card p-6 border-l-4 border-l-cyan-500 transition-all flex flex-col md:flex-row gap-6">

              {/* Left Side: Thumbnail & Download Overlay */}
              {(task.status === 'completed' || task.localFile) && (
                <a
                  href={`http://localhost:8000/api/download/${task.localFile}?title=${encodeURIComponent(task.title || 'TubeSync Video')}`}
                  download={`${task.title || 'TubeSync Video'}.mp4`}
                  className="w-full md:w-[40%] relative aspect-video rounded-xl overflow-hidden bg-gray-900 border border-gray-700/50 group block shadow-lg cursor-pointer shrink-0 animate-fade-in-up"
                >
                  <img
                    src={`https://img.youtube.com/vi/${extractVideoId(task.url)}/hqdefault.jpg`}
                    alt="Thumbnail"
                    className="w-full h-full object-cover transition-all duration-500 group-hover:scale-105 opacity-60 group-hover:opacity-40"
                  />

                  {/* Overlay Content */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-4 transition-all duration-300">
                    <div className="w-12 h-12 rounded-full bg-transparent text-white flex items-center justify-center mb-2 border-2 border-white backdrop-blur-[2px] shadow-lg group-hover:bg-white/10 group-hover:scale-110 transition-all duration-300">
                      <svg className="w-6 h-6 drop-shadow-sm" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </div>
                    <span className="font-bold text-white tracking-wide text-sm drop-shadow-md transition-all duration-300">
                      Local Download
                    </span>
                  </div>
                </a>
              )}

              {/* Right Side: Details & Progress */}
              <div className="flex-1 w-full flex flex-col min-w-0">
                <div className="flex justify-between items-start mb-4 gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-medium text-white flex items-center gap-2">
                      <span className="truncate" title={task.title || task.url}>
                        {task.title || task.url}
                      </span>
                    </h3>
                    <p className="text-sm text-gray-400 mt-1 truncate" title={task.title ? task.url : ''}>
                      {task.title ? task.url : 'No custom title provided'}
                    </p>
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-2">
                    {getStatusBadge(task)}
                    <span className="px-3 py-1 rounded-full text-[10px] font-medium border border-gray-600/50 text-gray-400 bg-transparent uppercase tracking-wider">
                      {task.resolution}p
                    </span>
                  </div>
                </div>

                {/* Progress Bars */}
                {(task.status === 'downloading' || task.status === 'uploading' || task.status === 'preparing' || task.status === 'completed') && (
                  <div className="space-y-4 mb-4">
                    {/* Download Bar */}
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{task.downloadText || 'Downloading from YouTube'}</span>
                        <span>{task.downloadPercent}%</span>
                      </div>
                      <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                        <div
                          className="bg-cyan-500 h-2 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${task.downloadPercent}%` }}
                        ></div>
                      </div>
                    </div>

                    {/* Upload Bar */}
                    {!task.skipUpload && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>{task.uploadText || 'Uploading to Channel'}</span>
                          <span>{task.uploadPercent}%</span>
                        </div>
                        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
                          <div
                            className="bg-purple-500 h-2 rounded-full transition-all duration-300 ease-out"
                            style={{ width: `${task.uploadPercent}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Reupload Link */}
                {(task.status === 'completed' || task.localFile) && (
                  <div className="mt-auto">
                    {task.status === 'completed' && task.watchUrl ? (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/40 border border-gray-700/50 group hover:border-gray-600 transition-colors">
                        <span className="text-gray-300 text-sm truncate mr-4">{task.watchUrl}</span>
                        <a
                          href={task.watchUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 text-sm font-medium hover:text-cyan-300 whitespace-nowrap"
                        >
                          Open &rarr;
                        </a>
                      </div>
                    ) : (
                      <div className="flex items-center p-3 rounded-lg bg-gray-900/40 border border-gray-700/50">
                        <span className="text-gray-500 text-sm italic truncate flex items-center gap-3">
                          <div className="w-4 h-4 border-2 border-gray-600/30 border-t-gray-500 rounded-full animate-spin"></div>
                          Processing Reupload Link...
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Error Message */}
                {task.status === 'error' && (
                  <div className="mt-4 p-3 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-sm">
                    {task.errorMessage || 'An unknown error occurred during transfer.'}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
