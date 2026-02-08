'use client';

import { useState, useEffect, useRef } from 'react';

// Define the structure of a story part
interface StoryPart {
  type: string;
  content: string;
}

export default function StoryDemoPage() {
  const [storyId, setStoryId] = useState<string | null>(null);
  const [storyParts, setStoryParts] = useState<StoryPart[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // This effect manages the EventSource connection lifecycle
  useEffect(() => {
    // Don't connect if we don't have a story ID
    if (!storyId) {
      return;
    }

    // Close any existing connection before opening a new one
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Create a new EventSource connection to our backend stream
    const eventSource = new EventSource(`http://localhost:8000/stream/${storyId}`);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connection opened.');
      setIsConnected(true);
    };

    // Listen for 'story_update' events from the server
    eventSource.addEventListener('story_update', (event) => {
      const newPart = JSON.parse(event.data);
      console.log('Received story part:', newPart);
      setStoryParts((prevParts) => [...prevParts, newPart]);
    });

    eventSource.onerror = (error) => {
      console.error('EventSource failed:', error);
      setIsConnected(false);
      eventSource.close();
    };

    // Cleanup function: close the connection when the component unmounts or storyId changes
    return () => {
      if (eventSourceRef.current) {
        console.log('Closing SSE connection.');
        eventSourceRef.current.close();
        setIsConnected(false);
      }
    };
  }, [storyId]); // Re-run this effect whenever the storyId changes

  // Function to create a new story
  const handleCreateStory = async () => {
    try {
      const response = await fetch('http://localhost:8000/story', { method: 'POST' });
      const data = await response.json();
      setStoryParts([]); // Clear old story parts
      setStoryId(data.story_id); // This will trigger the useEffect to connect
    } catch (error) {
      console.error('Failed to create story:', error);
    }
  };

  // Function to simulate an agent generating the next part of the story
  const handleTriggerNextPart = async () => {
    if (!storyId) {
      alert('Please create a story first.');
      return;
    }
    try {
      const content = `This is a new exciting part of story ${storyId.substring(0, 4)}...`;
      await fetch(`http://localhost:8000/story/${storyId}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (error) {
      console.error('Failed to trigger next part:', error);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: '800px', margin: 'auto' }}>
      <h1>Real-Time Story Demo</h1>
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '10px' }}>
        <button onClick={handleCreateStory}>Create New Story</button>
        <button onClick={handleTriggerNextPart} disabled={!storyId || !isConnected}>
          Trigger Next Part
        </button>
      </div>
      <div><strong>Story ID:</strong> {storyId || 'None'}</div>
      <div><strong>Connection Status:</strong> <span style={{ color: isConnected ? 'green' : 'red' }}>{isConnected ? 'Connected' : 'Disconnected'}</span></div>
      <hr style={{ margin: '1rem 0' }} />
      <h2>Story Unfolding:</h2>
      <ul style={{ listStyleType: 'none', padding: 0 }}>
        {storyParts.map((part, index) => (
          <li key={index} style={{ border: '1px solid #ccc', padding: '10px', marginBottom: '5px', borderRadius: '4px' }}>{part.content}</li>
        ))}
        {isConnected && storyParts.length === 0 && <p>Waiting for the story to begin...</p>}
      </ul>
    </div>
  );
}
