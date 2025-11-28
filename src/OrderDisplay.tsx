import React, { useState, useEffect, useRef } from 'react';
import { DriveThruClient } from './drive-thru-client.js';
import { createConfettiExplosion } from './confetti.js';
import { getProductImage } from './product-images.js';

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
    const [suggestions, setSuggestions] = useState<{ name: string, image: string }[]>([]);
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
                    const textLower = text.toLowerCase();

                    // 1. Confirmation Detection
                    const confirmKeywords = ['prochain guichet', 'confirmé', 'validé', 'merci', 'bonne journée'];
                    if (confirmKeywords.some(keyword => textLower.includes(keyword))) {
                        triggerOrderConfirmation();
                    }

                    // 2. Dessert Suggestion Detection (SoundHound Style)
                    const dessertKeywords = ['dessert', 'sucré', 'glace', 'plaisir', 'terminer', 'faim'];
                    if (dessertKeywords.some(keyword => textLower.includes(keyword))) {
                        setSuggestions([
                            { name: 'Sundae Chocolat', image: getProductImage('Sundae Chocolat') },
                            { name: 'Mix M&M\'s', image: getProductImage('Mix M&M\'s') },
                            { name: 'Churros', image: getProductImage('Churros') },
                            { name: 'Fondant', image: getProductImage('Fondant') }
                        ]);
                        // Auto-hide after 15s
                        setTimeout(() => setSuggestions([]), 15000);
                    }
                }
            },
            onOrderUpdate: (newOrder: any) => {
                setOrder(newOrder);
                // Clear suggestions if order updates (user chose something)
                if (suggestions.length > 0) setSuggestions([]);
            },
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
        <div className="h-screen w-full relative overflow-hidden bg-[#0a0a0a]">
            {/* CLICK TO START OVERLAY - FORCES USER INTERACTION FOR AUDIO */}
            {!isRunning && (
                <div className="absolute inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center animate-fadeIn">
                    <div className="text-center space-y-8">
                        <div className="w-32 h-32 mx-auto mb-6 animate-bounce">
                            <img src="/logo.png" alt="Quick Logo" className="w-full h-full object-contain drop-shadow-[0_0_30px_rgba(226,0,26,0.6)]" />
                        </div>
                        <h1 className="text-6xl font-bold text-white tracking-wider mb-4 font-['Oswald']">DRIVE-THRU</h1>
                        <p className="text-xl text-white/60 mb-8 max-w-md mx-auto">Cliquez pour activer le microphone et démarrer la commande vocale</p>

                        <button
                            onClick={handleToggleBot}
                            className="group relative px-12 py-6 bg-[#E2001A] hover:bg-[#ff001e] text-white rounded-2xl font-bold text-2xl transition-all hover:scale-105 shadow-[0_0_40px_rgba(226,0,26,0.4)] hover:shadow-[0_0_60px_rgba(226,0,26,0.6)] flex items-center gap-4 overflow-hidden"
                        >
                            <span className="relative z-10 flex items-center gap-3">
                                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                                DÉMARRER
                            </span>
                            <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300"></div>
                        </button>
                    </div>
                </div>
            )}

            {/* Ambient Aura Background */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] aura-gradient bg-[var(--quick-red)] rounded-full mix-blend-screen animate-pulse"></div>
            <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] aura-gradient bg-blue-600 rounded-full mix-blend-screen animate-pulse delay-1000"></div>

            {/* HEADER - FIXED POSITIONING (NUCLEAR OPTION) */}
            <div className="fixed top-6 left-6 right-6 h-20 z-[9999] glass-panel rounded-2xl p-4 flex items-center justify-between bg-[#141414]/90 backdrop-blur-xl border border-white/10 shadow-2xl">
                <div className="flex items-center gap-4">
                    <img src="/logo.png" alt="Quick Logo" className="h-12 object-contain drop-shadow-lg" />
                    <div className="h-8 w-[1px] bg-white/20"></div>
                    <h1 className="text-2xl font-bold text-white tracking-wider">DRIVE-THRU</h1>
                </div>
                <div className="flex items-center gap-6">
                    {/* Audio Debug Indicator */}
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 border border-white/10">
                        <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}></div>
                        <span className="text-xs font-mono text-white/70 font-bold">MIC: {isRunning ? 'ON' : 'OFF'}</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${status === 'connected' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`}></div>
                        <span className="text-sm font-medium text-white/80 uppercase tracking-widest">{status}</span>
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT - ABSOLUTE POSITIONING BELOW HEADER */}
            <div className="absolute top-32 bottom-6 left-6 right-6 grid grid-cols-3 gap-6 z-10">

                {/* LEFT PANEL: ORDER BOARD */}
                <div className="col-span-2 flex flex-col overflow-hidden h-full">
                    {/* Order List */}
                    <div ref={orderContainerRef} className="glass-panel rounded-2xl p-6 flex flex-col overflow-hidden h-full relative">
                        <div className="flex justify-between items-end mb-6 border-b border-white/10 pb-4 flex-shrink-0">
                            <h2 className="text-3xl font-bold text-white">VOTRE COMMANDE</h2>
                            {testMode && <span className="px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold border border-yellow-500/50">TEST MODE</span>}
                        </div>

                        <div className="flex-1 overflow-y-auto pr-2 space-y-3">
                            {!order || order.items.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-white/30 space-y-4">
                                    <div className="w-32 h-32 opacity-20 grayscale hover:grayscale-0 transition-all duration-500">
                                        <img src="/logo.png" alt="Quick Logo" className="w-full h-full object-contain" />
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
                <div className="col-span-1 flex flex-col overflow-hidden h-full">
                    <div className="glass-panel rounded-2xl h-full p-6 flex flex-col overflow-hidden relative">
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

            {/* VISUAL SUGGESTIONS OVERLAY (SoundHound Style) */}
            {suggestions.length > 0 && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-[100] flex gap-6 animate-slideUp">
                    {suggestions.map((item, idx) => (
                        <div key={idx} className="glass-panel p-4 rounded-2xl flex flex-col items-center gap-3 w-40 hover:scale-105 transition-transform cursor-pointer border-2 border-white/20 shadow-2xl bg-black/60 backdrop-blur-xl">
                            <div className="w-24 h-24 rounded-full bg-white/10 p-2 overflow-hidden">
                                <img src={item.image} alt={item.name} className="w-full h-full object-contain drop-shadow-lg" />
                            </div>
                            <span className="text-white font-bold text-center text-sm">{item.name}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
