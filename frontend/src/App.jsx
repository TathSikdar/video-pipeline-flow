import { useState } from 'react';
import { useWebSocket } from './hooks/useWebSocket';

function App() {
  const { messages, isConnected, clearMessages } = useWebSocket('ws://localhost:8000/ws/pipeline');
  const [isProcessing, setIsProcessing] = useState(false);

  const startPipeline = async () => {
    setIsProcessing(true);
    clearMessages();
    try {
      const response = await fetch('http://localhost:8000/api/start-pipeline', { method: 'POST' });
      if (!response.ok) throw new Error('Pipeline failed to start');
    } catch (err) {
      console.error(err);
      setIsProcessing(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      {/* Header */}
      <div className="text-center mb-12 animate-fade-in-up">
        <h1 className="text-5xl font-bold tracking-tight mb-4 animate-gradient-x bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400">
          Video Pipeline Flow
        </h1>
        <p className="text-gray-400 text-lg">Automated YouTube Download & Quota-Balanced Upload Engine</p>
      </div>

      {/* Main Glass Card */}
      <div className="glass-card p-8 mb-8 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
        <div className="flex justify-between items-center mb-8 border-b border-gray-700/50 pb-6">
          <div>
            <h2 className="text-2xl font-semibold text-white">Pipeline Control</h2>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-gray-400">WebSocket Status:</span>
              <span className={`h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]'}`}></span>
              <span className="text-sm font-medium">{isConnected ? 'Online' : 'Offline'}</span>
            </div>
          </div>
          
          <button 
            onClick={startPipeline}
            disabled={isProcessing || !isConnected}
            className="glass-button"
          >
            {isProcessing ? 'Processing...' : 'Start Pipeline'}
          </button>
        </div>

        {/* Live Terminal / Feed */}
        <div className="bg-gray-950/80 rounded-xl p-6 min-h-[350px] max-h-[500px] border border-gray-800 font-mono text-sm shadow-inner overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
          {messages.length === 0 ? (
            <div className="text-gray-500 h-full flex flex-col items-center justify-center italic py-20">
              <svg className="w-12 h-12 mb-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Awaiting pipeline initialization...
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg, idx) => (
                <div key={idx} className="animate-fade-in-up">
                  <span className="text-gray-500 mr-3 select-none">
                    [{new Date(msg.timestamp).toLocaleTimeString()}]
                  </span>
                  <span className={
                    msg.type === 'system' ? 'text-cyan-400' :
                    msg.type === 'success' ? 'text-emerald-400 font-bold' :
                    msg.type === 'error' ? 'text-rose-400' : 'text-gray-300'
                  }>
                    {msg.text}
                  </span>
                  {msg.url && (
                    <a href={msg.url} target="_blank" rel="noreferrer" className="ml-3 px-3 py-1 bg-blue-500/20 text-blue-400 rounded hover:bg-blue-500/40 transition-colors underline font-sans">
                      Watch Video
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
