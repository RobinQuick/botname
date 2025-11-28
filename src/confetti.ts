// ============================================
// Confetti Animation for Order Confirmation
// ============================================

export function createConfettiExplosion(container: HTMLElement) {
    const confettiCount = 150;
    const colors = ['#E2001A', '#FF4444', '#CC0000', '#FF6B6B', '#FFD700'];

    for (let i = 0; i < confettiCount; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';

        // Random properties
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 10 + 5;
        const startX = 50; // Center
        const startY = 50; // Center
        const angle = (Math.random() * 360);
        const velocity = Math.random() * 300 + 200;
        const rotation = Math.random() * 720 - 360;

        confetti.style.cssText = `
            position: fixed;
            left: ${startX}%;
            top: ${startY}%;
            width: ${size}px;
            height: ${size}px;
            background-color: ${color};
            border-radius: ${Math.random() > 0.5 ? '50%' : '0'};
            pointer-events: none;
            z-index: 9999;
            animation: confetti-burst 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
            --angle: ${angle}deg;
            --velocity: ${velocity}px;
            --rotation: ${rotation}deg;
        `;

        container.appendChild(confetti);

        // Remove after animation
        setTimeout(() => confetti.remove(), 1500);
    }
}

// CSS Animation (à ajouter dans index.css)
export const confettiCSS = `
@keyframes confetti-burst {
    0% {
        transform: translate(0, 0) rotate(0deg);
        opacity: 1;
    }
    100% {
        transform: 
            translate(
                calc(cos(var(--angle)) * var(--velocity)),
                calc(sin(var(--angle)) * var(--velocity) + 400px)
            )
            rotate(var(--rotation));
        opacity: 0;
    }
}

@keyframes order-implode {
    0% {
        transform: scale(1);
        opacity: 1;
    }
    50% {
        transform: scale(0.3);
        opacity: 0.8;
    }
    100% {
        transform: scale(0);
        opacity: 0;
    }
}

.order-confirm-animation {
    animation: order-implode 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards;
}
`;
