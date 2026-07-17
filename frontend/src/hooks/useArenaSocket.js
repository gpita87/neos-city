// Subscribe to a tournament's live socket events.
//
//   const { connected, joinMatch, leaveMatch, sendChat } = useArenaSocket(id, {
//     onTournamentUpdate, onScoreboard, onPairing, onMatchAssigned,
//     onMatchUpdate, onChatMessage, onReconnect,
//   });
//
// Handlers live in a ref so re-renders don't churn socket listeners. On every
// (re)connect we re-join the tournament room and fire onReconnect — callers
// should REST-refetch there, since pushes missed while disconnected are gone.

import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';

export function useArenaSocket(tournamentId, handlers = {}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!tournamentId) return undefined;
    const socket = getSocket();
    const call = (name) => (payload) => handlersRef.current[name]?.(payload);

    const onConnect = () => {
      setConnected(true);
      socket.emit('tournament:join', { tournamentId });
      handlersRef.current.onReconnect?.();
    };
    const onDisconnect = () => setConnected(false);

    const listeners = {
      'tournament:update': call('onTournamentUpdate'),
      'scoreboard:update': call('onScoreboard'),
      'pairing:new': call('onPairing'),
      'match:assigned': call('onMatchAssigned'),
      'match:update': call('onMatchUpdate'),
      'chat:message': call('onChatMessage'),
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    for (const [event, fn] of Object.entries(listeners)) socket.on(event, fn);

    if (socket.connected) onConnect();

    return () => {
      socket.emit('tournament:leave', { tournamentId });
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, fn] of Object.entries(listeners)) socket.off(event, fn);
    };
  }, [tournamentId]);

  const joinMatch = (matchId) =>
    new Promise((resolve) => getSocket().emit('match:join', { matchId }, resolve));
  const leaveMatch = (matchId) => getSocket().emit('match:leave', { matchId });
  const sendChat = (matchId, body) =>
    new Promise((resolve) => getSocket().emit('chat:send', { matchId, body }, resolve));

  return { connected, joinMatch, leaveMatch, sendChat };
}
