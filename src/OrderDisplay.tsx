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

    // Suggestions data banks
    const DRINKS = [
        { name: 'Coca-Cola', image: getProductImage('Coca-Cola') },
        { name: 'Sprite', image: getProductImage('Sprite') },
        { name: 'Fanta', image: getProductImage('Fanta Orange') },
        { name: 'Ice Tea', image: getProductImage('FuzeTea') }
    ];

    const DESSERTS = [
        { name: 'Sundae Chocolat', image: getProductImage('Sundae Chocolat') },
        { name: 'Mix M&M\'s', image: getProductImage('Mix M&M\'s') },
        { name: 'Churros', image: getProductImage('Churros') },
        { name: 'Fondant', image: getProductImage('Fondant') }
    ];

    const SIDES = [
        { name: 'Frites', image: getProductImage('Frites') },
        { name: 'Potatoes', image: getProductImage('Potatoes') },
        { name: 'Onion Rings', image: getProductImage('Onion Rings') }
    ];

    const SAUCES = [
        { name: 'Ketchup', image: getProductImage('Ketchup') },
        { name: 'Mayonnaise', image: getProductImage('Mayonnaise') },
        { name: 'BBQ', image: getProductImage('BBQ') },
        { name: 'Algérienne', image: getProductImage('Algérienne') }
    ];

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

                    // Dynamic contextual suggestions based on bot question
                    if (textLower.includes('boisson') || textLower.includes('boire')) {
                        setSuggestions(DRINKS);
                    } else if (textLower.includes('dessert') || textLower.includes('sucré')) {
                        setSuggestions(DESSERTS);
                    } else if (textLower.includes('accompagnement') || textLower.includes('frites') || textLower.includes('côté')) {
                        setSuggestions(SIDES);
                    } else if (textLower.includes('sauce')) {
                        setSuggestions(SAUCES);
                    }
                } else if (role === 'user') {
                    // Clear suggestions when user responds
                    setSuggestions([]);
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

    const testAudio = () => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 440; // A4
            osc.type = 'sine';
            osc.start();
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
            osc.stop(ctx.currentTime + 0.5);
            console.log('🔊 Test tone played');
        } catch (e) {
            console.error('❌ Audio test failed:', e);
            alert('Audio test failed. Check console.');
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
                    <button
                        onClick={testAudio}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full text-xs text-white/70 font-mono border border-white/10 transition-colors"
                    >
                        🔊 TEST AUDIO
                    </button>
                    <div className={`px-4 py-2 rounded-full border ${status === 'connected' ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-400'} text-xs font-mono uppercase tracking-wider`}>
                        {status}
                    </div>
                </div>
            </div>

            {/* MAIN LAYOUT: CENTERED ORDER CARD */}
            <div className="absolute top-28 bottom-8 left-0 right-0 px-4 md:px-8 flex justify-center items-center">
                <div className="w-full max-w-2xl h-full flex justify-center items-center">
                    <div ref={orderContainerRef} className="white-card w-full max-w-2xl h-[85vh] flex flex-col relative overflow-hidden transform transition-all duration-500">
                        {/* Card Header */}
                        <div className="bg-[#f8f8f8] p-6 border-b border-gray-100 flex justify-between items-center flex-shrink-0">
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

                        {/* SUGGESTIONS AREA (Inside Card) */}
                        {suggestions.length > 0 && (
                            <div className="bg-gray-50 p-4 border-t border-gray-100 flex-shrink-0">
                                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 text-center">Choisissez</h4>
                                <div className="flex gap-3 md:gap-4 overflow-x-auto pb-2 justify-start md:justify-center">
                                    {suggestions.map((item, idx) => (
                                        <div key={idx} className="bg-white rounded-xl p-2 md:p-3 w-20 md:w-28 flex flex-col items-center shadow-sm border border-gray-100 cursor-pointer hover:border-[#E2001A] active:border-[#E2001A] transition-colors group flex-shrink-0">
                                            <div className="w-12 h-12 md:w-16 md:h-16 mb-1 md:mb-2">
                                                <img src={item.image} alt={item.name} className="w-full h-full object-contain group-hover:scale-110 transition-transform" />
                                            </div>
                                            <span className="text-[9px] md:text-[10px] font-bold text-center text-gray-800 leading-tight uppercase font-['Oswald']">{item.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Total Bar */}
                        <div className="bg-[#E2001A] p-6 text-white flex justify-between items-center shadow-[0_-10px_40px_rgba(226,0,26,0.3)] z-20 flex-shrink-0">
                            <div className="flex flex-col">
                                <span className="text-white/80 text-sm font-medium uppercase tracking-widest">Total à payer</span>
                                <span className="text-xs text-white/60">{order?.itemCount || 0} articles</span>
                            </div>
                            <span className="text-5xl font-bold font-['Oswald'] tracking-tight">{order?.total || '0,00 €'}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* DEBUG INFO (Hidden but accessible) */}
            <div className="fixed bottom-2 right-2 text-[10px] text-white/10 font-mono pointer-events-none">
                {wsUrl}
            </div>
        </div>
    );
}
