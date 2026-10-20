import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './page';
import './globals.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
    state = { error: null as Error | null };
    static getDerivedStateFromError(error: Error) {
        return { error };
    }
    componentDidCatch(error: Error) {
        console.error('Madrasetna render error', error);
    }
    render() {
        if (this.state.error)
            return <main dir="rtl" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', fontFamily: 'Tahoma,Arial,sans-serif', background: '#f4f8f8', color: '#153b50' }}>
                <section style={{ maxWidth: 560, background: '#fff', border: '1px solid #dbe7e7', borderRadius: 18, padding: '2rem', textAlign: 'center' }}>
                    <h1 style={{ marginTop: 0 }}>حصل خطأ غير متوقع</h1>
                    <p style={{ lineHeight: 1.8, color: '#4b6470' }}>بياناتك محفوظة على الخادم. أعد تحميل الصفحة، ولو تكرر الخطأ راجع سجل المتصفح أو تواصل مع الأدمن.</p>
                    <button onClick={() => window.location.reload()} style={{ border: 0, borderRadius: 10, padding: '.75rem 1.4rem', background: '#168168', color: '#fff', font: 'inherit', cursor: 'pointer' }}>إعادة تحميل</button>
                </section>
            </main>;
        return this.props.children;
    }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
