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
            updated.downloadPercent = lastMessage.percent;
            updated.downloadText = lastMessage.text;
          } else if (lastMessage.stage === 'upload') {
            updated.status = 'uploading';
            updated.uploadPercent = lastMessage.percent;
            updated.uploadText = lastMessage.text;
          }
        } else if (lastMessage.type === 'success') {
          updated.status = 'completed';
          updated.watchUrl = lastMessage.url;
          updated.localFile = lastMessage.local_file;
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

  const getStatusBadge = (task) => {
    switch (task.status) {
      case 'queued': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-700 text-gray-300">Queued</span>;
      case 'preparing': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">Preparing...</span>;
      case 'downloading': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/20 text-cyan-400 animate-pulse">Downloading</span>;
      case 'uploading': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400 animate-pulse">Uploading</span>;
      case 'completed': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-400">Completed</span>;
      case 'error': return <span className="px-3 py-1 rounded-full text-xs font-medium bg-rose-500/20 text-rose-400">Failed</span>;
      default: return null;
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      {/* Header */}
      <div className="text-center mb-12 animate-fade-in-up">
        <h1 className="text-5xl font-bold tracking-tight mb-4 animate-gradient-x bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500">
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
            <div key={task.id} className="glass-card p-6 border-l-4 border-l-cyan-500 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-medium text-white truncate sm:max-w-md flex items-center gap-2">
                    {task.title || task.url}
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-700/50 text-gray-400 border border-gray-600/50 shrink-0">
                      {task.resolution}p
                    </span>
                  </h3>
                  <p className="text-sm text-gray-400 mt-1 truncate max-w-[300px] sm:max-w-md">
                    {task.title ? task.url : 'No custom title provided'}
                  </p>
                </div>
                <div>{getStatusBadge(task)}</div>
              </div>

              {/* Progress Bars */}
              {(task.status === 'downloading' || task.status === 'uploading' || task.status === 'preparing') && (
                <div className="space-y-4 mt-6">
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
                </div>
              )}

              {/* Completed Actions */}
              {task.status === 'completed' && (
                <div className="mt-6 flex flex-wrap gap-4">
                  <a
                    href={task.watchUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-center py-2 px-4 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all font-medium"
                  >
                    View on YouTube
                  </a>
                  {task.localFile && (
                    <a
                      href={`http://localhost:8000/api/download/${task.localFile}`}
                      download
                      className="flex-1 text-center py-2 px-4 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-all font-medium"
                    >
                      Download Local MP4
                    </a>
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
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
