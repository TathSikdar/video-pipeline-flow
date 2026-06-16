import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';

import { Header } from './components/Header';
import { InputForm } from './components/InputForm';
import { TaskQueue } from './components/TaskQueue';

function App() {
  const handleWebSocketMessage = useCallback((lastMessage) => {
    if (!lastMessage || !lastMessage.video_url) return;

    setTasks(prev => prev.map(task => {
      if (task.status === 'completed' || task.status === 'error') {
        return task;
      }

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
          if (!updated.skipUpload) {
            updated.status = 'upload_queued';
          }
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
  }, []);

  const { messages, isConnected } = useWebSocket('ws://localhost:8000/ws/pipeline', handleWebSocketMessage);
  const [videoUrl, setVideoUrl] = useState('');
  const [title, setTitle] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [description, setDescription] = useState('');
  const [resolution, setResolution] = useState('1080');
  const [reupload, setReupload] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [notification, setNotification] = useState(null);
  const [pulseId, setPulseId] = useState(null);
  const [urlError, setUrlError] = useState('');
  
  const pulseTimeoutRef = useRef(null);
  const notificationTimeoutRef = useRef(null);

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
      setUrlError('');
      return;
    }

    const httpsCount = (url.match(/https?:\/\//g) || []).length;
    if (httpsCount > 1) {
      setUrlError('Multiple URLs detected. Please paste only one valid YouTube URL.');
      setInfoFetched(false);
      setIsFetchingInfo(false);
      return;
    }

    const match = url.match(/(?:v=|\/v\/|youtu\.be\/|shorts\/|embed\/|^)([a-zA-Z0-9_-]{11})/);
    
    if (!match) {
      if (url.includes('youtube.com') || url.includes('youtu.be') || url.length > 20) {
        setUrlError('Invalid YouTube video URL.');
      } else {
        setUrlError('');
      }
      setInfoFetched(false);
      setIsFetchingInfo(false);
      return;
    }

    const videoId = match[1];

    setUrlError('');
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
          setUrlError('');
          setInfoFetched(true);
        } else {
          resetToDefaultResolutions();
          setOriginalTitle('');
          setUrlError('This video is currently unavailable, private, or has been deleted from YouTube.');
          setInfoFetched(false);
        }
      } catch (e) {
        resetToDefaultResolutions();
        setOriginalTitle('');
        setUrlError('Unable to retrieve video details. The video might be region-locked or restricted.');
        setInfoFetched(false);
      } finally {
        setIsFetchingInfo(false);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [videoUrl]);

  // Websocket messages are now handled directly by the onMessage callback passed to useWebSocket

  const addToQueue = async () => {
    if (!videoUrl.trim()) return;

    const newUrl = videoUrl.trim();
    const newTitle = title.trim() || (originalTitle ? `TransferTube | ${originalTitle}` : '');
    const newDescription = description.trim();
    const newSkipUpload = !reupload;

    // Check for exact duplicates
    const duplicate = tasks.find(t => 
      t.url === newUrl && 
      t.title === newTitle && 
      t.description === newDescription && 
      t.resolution === resolution && 
      t.skipUpload === newSkipUpload
    );

    if (duplicate) {
      if (pulseTimeoutRef.current) clearTimeout(pulseTimeoutRef.current);
      if (notificationTimeoutRef.current) clearTimeout(notificationTimeoutRef.current);

      // Force React to clear the animation class, then re-apply it next tick
      setPulseId(null);
      
      if (!notification) {
        setNotification('This exact video task is already in the queue or completed!');
      }
      
      setTimeout(() => {
        setPulseId(duplicate.id);
        pulseTimeoutRef.current = setTimeout(() => setPulseId(null), 1000);
      }, 10);

      // Hide notification after 3s
      notificationTimeoutRef.current = setTimeout(() => {
        setNotification(null);
      }, 3000);

      return;
    }

    const newTask = {
      id: Date.now(),
      url: newUrl,
      title: newTitle,
      description: newDescription,
      resolution,
      skipUpload: newSkipUpload,
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
            task_id: String(newTask.id),
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

  const removeTask = async (taskId) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    
    try {
      await fetch('http://localhost:8000/api/cancel-pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: String(taskId) })
      });
    } catch (err) {
      console.error('Failed to cancel task on backend:', err);
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl relative">
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50">
          <div className="animate-slide-down">
            <div className="bg-gray-800 text-white px-6 py-4 rounded-xl shadow-2xl border border-rose-500/50 flex items-center gap-3">
              <svg className="w-6 h-6 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="font-medium text-sm">{notification}</span>
            </div>
          </div>
        </div>
      )}

      <Header />

      <InputForm
        videoUrl={videoUrl}
        setVideoUrl={setVideoUrl}
        urlError={urlError}
        isFetchingInfo={isFetchingInfo}
        infoFetched={infoFetched}
        title={title}
        setTitle={setTitle}
        originalTitle={originalTitle}
        availableResolutions={availableResolutions}
        resolution={resolution}
        setResolution={setResolution}
        reupload={reupload}
        setReupload={setReupload}
        description={description}
        setDescription={setDescription}
        isConnected={isConnected}
        addToQueue={addToQueue}
      />

      <div className="flex flex-col gap-12">
        <TaskQueue tasks={tasks.filter(t => t.status === 'completed' || t.status === 'error')} title="Completed" pulseId={pulseId} onRemove={removeTask} />
        <TaskQueue tasks={tasks.filter(t => t.status !== 'completed' && t.status !== 'error')} title="Queue" pulseId={pulseId} onRemove={removeTask} />
      </div>
    </div>
  );
}

export default App;
