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
    const [isRunning, setIsRunning] = useState<boolean>(false);
    const [suggestions, setSuggestions] = useState<{ name: string, image: string }[]>([]);
    const clientRef = useRef<DriveThruClient | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);
    const orderContainerRef = useRef<HTMLDivElement>(null);

    // Initial Suggestions (Always visible in this design until order confirms)
    useEffect(() => {
        setSuggestions([
            { name: 'Sundae Chocolat', image: getProductImage('Sundae Chocolat') },
            { name: 'Mix M&M\'s', image: getProductImage('Mix M&M\'s') },
            { name: 'Churros', image: getProductImage('Churros') },
            { name: 'Fondant', image: getProductImage('Fondant') }
        ]);
    }, []);

    useEffect(() => {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(() => console.log('✅ Mic permission granted'))
            .catch(err => {
                console.error('❌ Mic permission denied:', err);
                alert('Veuillez autoriser le microphone !');
            });
    }, []);

    useEffect(() => {
        if (!isRunning) return;

        clientRef.current = new DriveThruClient({
            serverUrl: `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/drive-thru`,
            testMode,
            onOrderUpdate: (newOrder: any) => setOrder(newOrder),
            onTranscript: (role: string, text: string) => {
                setTranscripts(prev => [...prev, { role: role as 'assistant' | 'user', text }]);
                if (role === 'assistant') {
                    const textLower = text.toLowerCase();
                    const confirmKeywords = ['prochain guichet', 'confirmé', 'validé', 'merci', 'bonne journée'];
                    if (confirmKeywords.some(keyword => textLower.includes(keyword))) {
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
            orderContainerRef.current.classList.add('order-confirm-animation');
            setTimeout(() => createConfettiExplosion(document.body), 300);
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
            clientRef.current?.disconnect();
            setIsRunning(false);
            setStatus('stopped');
        } else {
            setIsRunning(true);
        }
    };

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/drive-thru`;

    return (
        <div className="h-screen w-full relative overflow-hidden bg-[#0a0a0a] font-['Inter']">

            {/* START OVERLAY */}
            {!isRunning && (
                <div className="absolute inset-0 z-[10000] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-fadeIn">
                    <div className="text-center space-y-8">
                        <div className="w-40 h-40 mx-auto mb-6">
                            <img src="/logo.png" alt="Quick Logo" className="w-full h-full object-contain" />
                        </div>
                        <h1 className="text-7xl font-bold text-white tracking-tighter mb-4 font-['Oswald'] uppercase">Drive-Thru</h1>
                        <button
                            onClick={handleToggleBot}
                            className="px-16 py-6 bg-[#E2001A] hover:bg-[#ff001e] text-white rounded-full font-bold text-3xl transition-all hover:scale-105 shadow-[0_0_50px_rgba(226,0,26,0.5)]"
                        >
                            COMMENCER
                        </button>
                    </div>
                </div>
            )}

            {/* HEADER */}
            <div className="fixed top-0 left-0 right-0 h-24 z-50 flex items-center justify-between px-8 bg-gradient-to-b from-black/80 to-transparent">
                <img src="/logo.png" alt="Quick Logo" className="h-16 object-contain" />
                <h1 className="text-4xl font-bold text-white tracking-widest font-['Oswald'] uppercase drop-shadow-md">Votre Commande</h1>
                <div className="flex items-center gap-4">
                    <div className={`px-4 py-2 rounded-full border ${status === 'connected' ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-400'} text-xs font-mono uppercase tracking-wider`}>
                        {status}
                    </div>
                </div>
            </div>

            {/* MAIN LAYOUT: 2 COLUMNS (Order Card + Transcript) */}
            <div className="absolute top-28 bottom-48 left-0 right-0 px-8 grid grid-cols-12 gap-8">

                {/* LEFT: TRANSCRIPT (Subtle) */}
                <div className="col-span-4 flex flex-col justify-center h-full opacity-80">
                    <div className="glass-panel rounded-3xl p-6 h-[60vh] flex flex-col relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-16 bg-gradient-to-b from-[var(--glass-bg)] to-transparent z-10"></div>
                        <div className="flex-1 overflow-y-auto space-y-4 py-4 px-2">
                            {transcripts.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-white/20 text-center italic">
                                    "Je vous écoute..."
                                </div>
                            ) : (
                                transcripts.map((msg, idx) => (
                                    <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                        <div className={`max-w-[90%] p-4 rounded-2xl text-lg ${msg.role === 'user'
                                            ? 'bg-white/10 text-white rounded-tr-sm'
                                            : 'bg-[#E2001A]/20 text-white/90 rounded-tl-sm border border-[#E2001A]/30'
                                            }`}>
                                            {msg.text}
                                        </div>
                                    </div>
                                ))
                            )}
                            <div ref={transcriptEndRef} />
                        </div>
                        <div className="absolute bottom-0 left-0 w-full h-16 bg-gradient-to-t from-[var(--glass-bg)] to-transparent z-10"></div>
                    </div>
                </div>

                {/* CENTER/RIGHT: WHITE ORDER CARD (The Star) */}
                <div className="col-span-8 flex justify-center items-center h-full">
                    <div ref={orderContainerRef} className="white-card w-full max-w-2xl h-[70vh] flex flex-col relative overflow-hidden transform transition-all duration-500">
                        {/* Card Header */}
                        <div className="bg-[#f8f8f8] p-6 border-b border-gray-100 flex justify-between items-center">
                            <span className="text-gray-400 font-bold tracking-widest text-sm uppercase">Ticket #042</span>
                            <span className="text-[#E2001A] font-bold text-lg">SUR PLACE</span>
                        </div>

                        {/* Order Items List */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-white">
                            {!order || order.items.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-300 space-y-4">
                                    <svg className="w-24 h-24 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>
                                    <p className="text-xl font-medium">En attente de produits...</p>
                                </div>
                            ) : (
                                order.items.map((item, index) => (
                                    <div key={index} className="flex items-start justify-between group border-b border-gray-50 pb-4 last:border-0 animate-slideInFromLeft">
                                        <div className="flex gap-4 items-center">
                                            {/* Image */}
                                            <div className="w-20 h-20 rounded-xl bg-gray-50 p-2 flex-shrink-0">
                                                {item.imageUrl ? (
                                                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-contain mix-blend-multiply" />
                                                ) : (
                                                    <span className="text-3xl flex items-center justify-center w-full h-full">🍔</span>
                                                )}
                                            </div>

                                            {/* Text */}
                                            <div>
                                                <div className="flex items-baseline gap-3">
                                                    <span className="text-[#E2001A] font-bold text-lg">{item.quantity}x</span>
                                                    <h3 className="text-2xl font-bold text-[#1a1a1a] font-['Oswald'] uppercase leading-none">{item.name}</h3>
                                                </div>
                                                {item.size && <p className="text-gray-500 text-sm font-medium mt-1 uppercase tracking-wide">{item.size}</p>}
                                                {item.modifiers && item.modifiers.length > 0 && (
                                                    <div className="flex flex-wrap gap-2 mt-2">
                                                        {item.modifiers.map((mod, i) => (
                                                            <span key={i} className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 font-medium">
                                                                + {mod.name}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Price */}
                                        <span className="text-xl font-bold text-[#1a1a1a]">{item.price}</span>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Total Bar */}
                        <div className="bg-[#E2001A] p-6 text-white flex justify-between items-center shadow-[0_-10px_40px_rgba(226,0,26,0.3)] z-20">
                            <div className="flex flex-col">
                                <span className="text-white/80 text-sm font-medium uppercase tracking-widest">Total à payer</span>
                                <span className="text-xs text-white/60">{order?.itemCount || 0} articles</span>
                            </div>
                            <span className="text-5xl font-bold font-['Oswald'] tracking-tight">{order?.total || '0,00 €'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* BOTTOM SUGGESTIONS PANEL */}
            <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-black via-black/90 to-transparent z-40 flex items-center justify-center pb-6">
                <div className="flex gap-6 overflow-x-auto px-8 pb-4 pt-8 w-full justify-center max-w-6xl">
                    {suggestions.map((item, idx) => (
                        <div key={idx} className="white-card w-32 h-32 flex-shrink-0 flex flex-col items-center justify-center p-2 gap-2 cursor-pointer hover:scale-105 transition-transform duration-300 shadow-lg group">
                            <div className="w-16 h-16 relative">
                                <img src={item.image} alt={item.name} className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500" />
                            </div>
                            <span className="text-[#1a1a1a] font-bold text-xs text-center uppercase font-['Oswald'] leading-tight">{item.name}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* DEBUG INFO (Hidden but accessible) */}
            <div className="fixed bottom-2 right-2 text-[10px] text-white/10 font-mono pointer-events-none">
                {wsUrl}
            </div>
        </div>
    );
}
