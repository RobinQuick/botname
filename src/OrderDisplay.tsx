import React, { useState, useEffect, useRef } from 'react';
import { DriveThruClient } from './drive-thru-client.js';
import { createConfettiExplosion } from './confetti.js';

interface OrderItemDisplay {
    name: string;
    quantity: number;
    size?: string;
    modifiers: { name: string; extraPrice: string | null }[];
    price: string;
    imageUrl?: string;
}

interface OrderDisplayData {
    items: OrderItemDisplay[];
    subtotal: string;
    discounts: { description: string; amount: string }[];
    total: string;
    itemCount: number;
}

interface TranscriptItem {
    role: 'assistant' | 'user';
    text: string;
}

export function DriveThruScreen({ testMode = false }: { testMode?: boolean }) {
    const [status, setStatus] = useState<string>('disconnected');
    const [order, setOrder] = useState<OrderDisplayData | null>(null);
    const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
    const [isRunning, setIsRunning] = useState<boolean>(false); // Start STOPPED to force user gesture
    const clientRef = useRef<DriveThruClient | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const orderContainerRef = useRef<HTMLDivElement>(null);

    // Request mic permission on page load
    useEffect(() => {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(() => console.log('✅ Mic permission granted'))
            .catch(err => {
                console.error('❌ Mic permission denied:', err);
                alert('Veuillez autoriser le microphone pour utiliser le bot vocal!');
            });
    }, []);

    useEffect(() => {
        if (!isRunning) return; // Don't connect if stopped

        clientRef.current = new DriveThruClient({
            serverUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/drive-thru`,
            testMode,
            onOrderUpdate: (newOrder: any) => setOrder(newOrder),
            onTranscript: (role: string, text: string) => {
                setTranscripts(prev => [...prev, { role: role as 'assistant' | 'user', text }]);

                // Detect order confirmation keywords
                if (role === 'assistant') {
                    const confirmKeywords = ['prochain guichet', 'confirmé', 'validé', 'merci', 'bonne journée'];
                    if (confirmKeywords.some(keyword => text.toLowerCase().includes(keyword))) {
                        triggerOrderConfirmation();
                    }
                }
            },
            onStatusChange: (newStatus: string) => setStatus(newStatus)
        });

        clientRef.current.connect();

        return () => {
            clientRef.current?.disconnect();
        };
    }, [isRunning]);

    const triggerOrderConfirmation = () => {
        if (orderContainerRef.current) {
            // Animate order panel (implode)
            orderContainerRef.current.classList.add('order-confirm-animation');

            // Trigger confetti explosion
            setTimeout(() => {
                createConfettiExplosion(document.body);
            }, 300);

            // Reset after animation
            setTimeout(() => {
                setOrder(null);
                setTranscripts([]);
                if (orderContainerRef.current) {
                    orderContainerRef.current.classList.remove('order-confirm-animation');
                }
            }, 2000);
        }
    };

    useEffect(() => {
        if (transcriptEndRef.current) {
            transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcripts]);

    const handleToggleBot = () => {
        if (isRunning) {
            // STOP the bot
            clientRef.current?.disconnect();
            setIsRunning(false);
            setStatus('stopped');
        } else {
            // START the bot
            setIsRunning(true);
        }
    };

    const handleInterrupt = () => {
        clientRef.current?.interrupt();
    };

    const handleForceReply = () => {
        clientRef.current?.forceReply();
    };

    return (
        <div className="h-screen w-full relative overflow-hidden flex flex-col">
            {/* Ambient Aura Background */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] aura-gradient bg-[var(--quick-red)] rounded-full mix-blend-screen animate-pulse"></div>
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] aura-gradient bg-blue-600 rounded-full mix-blend-screen animate-pulse delay-1000"></div>

            {/* Main Content Container - GRID LAYOUT */}
            <div className="z-10 flex-1 p-6 grid grid-cols-3 gap-6 overflow-hidden">

                {/* LEFT PANEL: ORDER BOARD */}
                <div className="col-span-2 grid grid-rows-[auto_1fr] gap-4 overflow-hidden h-full min-h-0">
                    {/* Header with Logo - FIXED ROW */}
                    <div className="glass-panel rounded-2xl p-4 flex items-center justify-between shrink-0 z-20">
                        <div className="flex items-center gap-4">
                            <img src="/logo.png" alt="Quick Logo" className="h-12 object-contain drop-shadow-lg" />
                            <div className="h-8 w-[1px] bg-white/20"></div>
                            <h1 className="text-2xl font-bold text-white tracking-wider">DRIVE-THRU</h1>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className={`w-3 h-3 rounded-full ${status === 'connected' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
                            <span className="text-sm font-medium text-white/80 uppercase tracking-widest">{status}</span>
                        </div>
                    </div>

                    {/* Order List - SCROLLABLE ROW */}
                    <div ref={orderContainerRef} className="glass-panel rounded-2xl p-6 flex flex-col overflow-hidden h-full min-h-0 relative">
                        <div className="flex justify-between items-end mb-6 border-b border-white/10 pb-4 flex-shrink-0">
                            <h2 className="text-3xl font-bold text-white">VOTRE COMMANDE</h2>
                            {testMode && <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold border border-yellow-500/50">TEST MODE</span>}
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                            {!order || order.items.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4">
                                    <div className="w-16 h-16 rounded-full border-2 border-white/10 flex items-center justify-center">
                                        <span className="text-2xl">🍔</span>
                                    </div>
                                    <p className="text-lg font-light">En attente de votre commande...</p>
                                </div>
                            ) : (
                                order.items.map((item, index) => (
                                    /* ANIMATION: Slide in from left */
                                    <div key={index} className="glass-card rounded-xl p-4 flex justify-between items-start group">
                                        <div className="flex gap-4 items-center w-full">
                                            {/* Product Image */}
                                            <div className="w-20 h-20 rounded-lg bg-white/5 flex-shrink-0 overflow-hidden border border-white/10">
                                                {item.imageUrl ? (
                                                    <img
                                                        src={item.imageUrl}
                                                        alt={item.name}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => {
                                                            // Fallback to emoji if image fails to load
                                                            e.currentTarget.style.display = 'none';
                                                            e.currentTarget.parentElement!.innerHTML = '<span class="text-4xl flex items-center justify-center w-full h-full">🍔</span>';
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="text-4xl flex items-center justify-center w-full h-full">🍔</span>
                                                )}
                                            </div>

                                            {/* Quantity Badge */}
                                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-[var(--quick-red)] flex-shrink-0">
                                                {item.quantity}x
                                            </div>

                                            {/* Item Details */}
                                            <div className="flex-1">
                                                <h3 className="text-xl font-bold text-white leading-none mb-1">{item.name}</h3>
                                                {item.size && <p className="text-sm text-white/60 uppercase">{item.size}</p>}
                                                {item.modifiers && item.modifiers.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-2">
                                                        {item.modifiers.map((mod, i) => (
                                                            <span key={i} className="text-xs px-2 py-1 rounded bg-white/5 text-white/80 border border-white/10">
                                                                + {mod.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Price */}
                                            <span className="text-xl font-bold text-white/90 flex-shrink-0">{item.price}</span>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Total Footer */}
                        <div className="mt-6 pt-6 border-t border-white/10">
                            <div className="flex justify-between items-end">
                                <span className="text-white/60 text-lg font-light uppercase tracking-widest">Total à payer</span>
                                <span className="text-5xl font-bold text-white text-glow">{order?.total || '0,00 €'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* RIGHT PANEL: LIVE TRANSCRIPT */}
                <div className="col-span-1 overflow-hidden">
                    <div className="glass-panel rounded-2xl h-full p-6 flex flex-col overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-20 bg-gradient-to-b from-[var(--glass-bg)] to-transparent z-10 pointer-events-none"></div>

                        <h2 className="text-xl font-bold text-white/50 mb-4 uppercase tracking-widest text-center">Conversation</h2>

                        <div className="flex-1 overflow-y-auto space-y-4 py-4 px-2">
                            {transcripts.map((msg, idx) => (
                                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`max-w-[85%] p-4 rounded-2xl backdrop-blur-md border ${msg.role === 'user'
                                        ? 'bg-[var(--quick-red)]/20 border-[var(--quick-red)]/30 text-white rounded-tr-sm'
                                        : 'bg-white/10 border-white/10 text-white/90 rounded-tl-sm'
                                        }`}>
                                        <p className="text-lg leading-relaxed">{msg.text}</p>
                                    </div>
                                    <span className="text-xs text-white/30 mt-1 px-2">
                                        {msg.role === 'user' ? 'Client' : 'Marin'}
                                    </span>
                                </div>
                            ))}
                            <div ref={transcriptEndRef} />
                        </div>

                        {/* Controls */}
                        <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={handleToggleBot}
                                    className={`p-3 ${isRunning ? 'bg-red-600/80 hover:bg-red-600' : 'bg-green-600/80 hover:bg-green-600'} text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 text-sm backdrop-blur-sm`}
                                >
                                    {isRunning ? '⏹ STOP' : '▶ START'}
                                </button>
                                <button
                                    onClick={handleForceReply}
                                    className="p-3 bg-blue-600/80 hover:bg-blue-600 text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 text-sm backdrop-blur-sm"
                                >
                                    RÉPONDRE
                                </button>
                                <button
                                    onClick={() => clientRef.current?.identifyCustomer('QR_THOMAS_123')}
                                    className="col-span-2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2 text-sm backdrop-blur-sm border border-white/10"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4h-4v-4H8m13-4V4h-4v5h4M4 4h5v5H4V4zm0 13h5v5H4v-5zm13 0h5v5h-5v-5z" /></svg>
                                    SCAN QR CLIENT
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
