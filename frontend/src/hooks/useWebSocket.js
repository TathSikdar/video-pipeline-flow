import { useState, useEffect, useCallback, useRef } from 'react';

export const useWebSocket = (url) => {
    const [messages, setMessages] = useState([]);
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        
        const ws = new WebSocket(url);
        
        ws.onopen = () => {
            setIsConnected(true);
            setMessages(prev => [...prev, { type: 'system', text: 'Pipeline channel connected.', timestamp: Date.now() }]);
        };
        
        ws.onmessage = (event) => {
            try {
                // Handle structured JSON
                const data = JSON.parse(event.data);
                setMessages(prev => [...prev, { ...data, timestamp: Date.now() }]);
            } catch (e) {
                // Handle plain text
                setMessages(prev => [...prev, { type: 'info', text: event.data, timestamp: Date.now() }]);
            }
        };
        
        ws.onclose = () => {
            setIsConnected(false);
            wsRef.current = null;
            setMessages(prev => [...prev, { type: 'system', text: 'Pipeline channel disconnected.', timestamp: Date.now() }]);
            
            // Reconnect logic
            setTimeout(connect, 3000);
        };
        
        wsRef.current = ws;
    }, [url]);

    useEffect(() => {
        connect();
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [connect]);

    return { messages, isConnected, clearMessages: () => setMessages([]) };
};
