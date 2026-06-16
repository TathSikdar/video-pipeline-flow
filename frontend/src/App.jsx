import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';

import { Header } from './components/Header';
import { InputForm } from './components/InputForm';
import { TaskQueue } from './components/TaskQueue';

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

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <Header />

      <InputForm
        videoUrl={videoUrl}
        setVideoUrl={setVideoUrl}
        isFetchingInfo={isFetchingInfo}
        infoFetched={infoFetched}
        title={title}
        setTitle={setTitle}
        originalTitle={originalTitle}
        availableResolutions={availableResolutions}
        resolution={resolution}
        setResolution={setResolution}
        skipUpload={skipUpload}
        setSkipUpload={setSkipUpload}
        description={description}
        setDescription={setDescription}
        isConnected={isConnected}
        addToQueue={addToQueue}
      />

      <TaskQueue tasks={tasks} />
    </div>
  );
}

export default App;
