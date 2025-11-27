import React, { useState, useEffect, useRef } from 'react';
import { DriveThruClient } from './drive-thru-client';

interface OrderItemDisplay {
    name: string;
    quantity: number;
    size?: string;
    modifiers: { name: string; extraPrice: string | null }[];
    price: string;
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
    const clientRef = useRef<DriveThruClient | null>(null);
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        clientRef.current = new DriveThruClient({
            serverUrl: `ws://${window.location.hostname}:3000/drive-thru`,
            testMode,
            onOrderUpdate: (newOrder) => setOrder(newOrder),
            onTranscript: (role, text) => {
                setTranscripts(prev => [...prev, { role: role as 'assistant' | 'user', text }]);
            },
            onStatusChange: (newStatus) => setStatus(newStatus)
        });

        clientRef.current.connect();

        return () => {
            clientRef.current?.disconnect();
        };
    }, []);

    useEffect(() => {
        if (transcriptEndRef.current) {
            transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [transcripts]);

    const handleInterrupt = () => {
        clientRef.current?.interrupt();
    };

    const handleForceReply = () => {
        clientRef.current?.forceReply();
    };

    return (
        <div className="flex h-screen bg-gray-900 text-white font-sans overflow-hidden">
            {/* Left Panel: Order Display */}
            <div className="w-2/3 flex flex-col border-r border-gray-800">
                {/* Header */}
                <div className="p-6 border-b border-gray-800 flex justify-between items-center bg-gray-900">
                    <div className="flex items-center gap-4">
                        <img src="/quick-logo.png" alt="Quick" className="h-12 w-12 object-contain" />
                        <h1 className="text-2xl font-bold tracking-wider text-red-600">
                            {testMode ? 'TEST MODE' : 'DRIVE-THRU'}
                        </h1>
                    </div>
                    <div className="flex gap-2">
                        {testMode && (
                            <div className="px-4 py-1 rounded-full text-sm font-medium bg-yellow-600 text-white animate-pulse">
                                TEST
                            </div>
                        )}
                        <div className={`px-4 py-1 rounded-full text-sm font-medium ${status === 'connected' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                            }`}>
                            {status.toUpperCase()}
                        </div>
                    </div>
                </div>

                {/* Order List */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-900">
                    {order?.items.map((item, index) => (
                        <div key={index} className="flex justify-between items-start p-4 bg-gray-800 rounded-lg shadow-sm border-l-4 border-red-600 animate-fade-in">
                            <div className="flex gap-4">
                                <div className="bg-gray-700 w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold text-white">
                                    {item.quantity}
                                </div>
                                <div>
                                    <h3 className="text-xl font-bold text-white">{item.name}</h3>
                                    {item.size && (
                                        <div className="text-gray-400 text-sm mt-1">Taille: {item.size === 'medium' ? 'Moyen' : item.size === 'large' ? 'Grand' : 'Petit'}</div>
                                    )}
                                    {item.modifiers.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {item.modifiers.map((mod, idx) => (
                                                <div key={idx} className="text-gray-400 text-sm flex items-center gap-2">
                                                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
                                                    {mod.name}
                                                    {mod.extraPrice && <span className="text-gray-500">({mod.extraPrice})</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="text-xl font-bold text-white">{item.price}</div>
                        </div>
                    ))}

                    {(!order || order.items.length === 0) && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-600 opacity-50">
                            <div className="text-6xl mb-4">🍔</div>
                            <div className="text-2xl">En attente de commande...</div>
                        </div>
                    )}
                </div>

                {/* Totals */}
                <div className="p-8 bg-gray-800 border-t border-gray-700 shadow-lg">
                    <div className="space-y-2 mb-6">
                        <div className="flex justify-between text-gray-400 text-lg">
                            <span>Sous-total</span>
                            <span>{order?.subtotal || '0,00€'}</span>
                        </div>
                        {order?.discounts.map((discount, idx) => (
                            <div key={idx} className="flex justify-between text-green-400 text-lg">
                                <span>{discount.description}</span>
                                <span>{discount.amount}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-between items-center pt-6 border-t border-gray-700">
                        <span className="text-3xl font-bold text-white">TOTAL</span>
                        <span className="text-5xl font-extrabold text-red-500">{order?.total || '0,00€'}</span>
                    </div>
                </div>
            </div>

            {/* Right Panel: Conversation & Controls */}
            <div className="w-1/3 bg-gray-950 flex flex-col">
                {/* Transcript */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {transcripts.map((t, i) => (
                        <div key={i} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] p-4 rounded-2xl shadow-md ${t.role === 'user'
                                ? 'bg-blue-600 text-white rounded-tr-none'
                                : 'bg-gray-800 text-gray-200 rounded-tl-none border border-gray-700'
                                }`}>
                                <div className="text-xs opacity-50 mb-1 uppercase tracking-wider font-bold">
                                    {t.role === 'user' ? 'Client' : 'Quick Bot'}
                                </div>
                                <div className="text-lg leading-relaxed">{t.text}</div>
                            </div>
                        </div>
                    ))}
                    <div ref={transcriptEndRef} />
                </div>

                {/* Controls */}
                <div className="p-6 bg-gray-900 border-t border-gray-800 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            onClick={handleInterrupt}
                            className="p-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" /></svg>
                            INTERROMPRE
                        </button>
                        <button
                            onClick={handleForceReply}
                            className="p-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all active:scale-95 shadow-lg flex items-center justify-center gap-2"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                            FORCER RÉPONSE
                        </button>
                    </div>
                    <div className="text-center text-gray-500 text-sm">
                        Microphone actif • VAD activé
                    </div>
                </div>
            </div>
        </div>
    );
}
