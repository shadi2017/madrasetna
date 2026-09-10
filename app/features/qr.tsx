import { useEffect, useRef, useState } from 'react';
import { Camera, Download, ScanLine, Square } from 'lucide-react';
import QRCode from 'qrcode';
import type { Html5Qrcode } from 'html5-qrcode';
import { Student, parseQr, safeError } from '../core/model';
export function QrCard({ student, school }: {
    student: Student;
    school: string;
}) { const [src, setSrc] = useState(''); useEffect(() => { let alive = true; QRCode.toDataURL('madrasetna:v1:' + student.qr_token, { width: 360, margin: 4, errorCorrectionLevel: 'M' }).then(s => alive && setSrc(s)); return () => { alive = false; }; }, [student.qr_token]); return <div className="qr-card"><b>{school}</b>{src ? <img src={src} width="240" height="240" alt={'كود الحضور الخاص بـ ' + student.full_name}/> : <p>جاري تجهيز الرمز…</p>}<h3>{student.full_name}</h3><span dir="ltr">@{student.username}</span><p>اعرض الرمز للأدمن عند تسجيل الحضور.</p>{src && <a className="secondary" href={src} download={student.username + '-qr.png'}><Download size={17}/>حفظ QR</a>}</div>; }
export function Scanner({ onScan, disabled }: {
    onScan: (token: string) => Promise<{
        name: string;
        duplicate: boolean;
    }>;
    disabled: boolean;
}) {
    const [active, setActive] = useState(false), [starting, setStarting] = useState(false), [message, setMessage] = useState(''), [manual, setManual] = useState(''), [result, setResult] = useState<{
        name: string;
        duplicate: boolean;
    } | null>(null);
    const scanner = useRef<Html5Qrcode | null>(null), mounted = useRef(true), locked = useRef(false), last = useRef(0), callback = useRef(onScan), disabledRef = useRef(disabled);
    callback.current = onScan;
    disabledRef.current = disabled;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; const s = scanner.current; if (s?.isScanning)
        void s.stop().then(() => s.clear()).catch(() => { }); }; }, []);
    async function read(value: string) { if (locked.current || disabledRef.current || Date.now() - last.current < 2500)
        return; locked.current = true; last.current = Date.now(); try {
        const res = await callback.current(parseQr(value));
        if (mounted.current) {
            setResult(res);
            setMessage('');
        }
    }
    catch (e) {
        if (mounted.current) {
            setResult(null);
            setMessage(safeError(e));
        }
    }
    finally {
        locked.current = false;
    } }
    async function start() { setStarting(true); setMessage(''); try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!mounted.current)
            return;
        const s = new Html5Qrcode('qr-reader');
        scanner.current = s;
        await s.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 230, height: 230 } }, text => void read(text), () => { });
        if (!mounted.current) {
            await s.stop();
            s.clear();
            return;
        }
        setActive(true);
    }
    catch {
        setMessage('تعذر فتح الكاميرا. اسمح باستخدامها من إعدادات المتصفح وافتح التطبيق عبر HTTPS، أو الصق محتوى الرمز.');
    }
    finally {
        if (mounted.current)
            setStarting(false);
    } }
    async function stop() { try {
        if (scanner.current?.isScanning)
            await scanner.current.stop();
        scanner.current?.clear();
    }
    finally {
        setActive(false);
    } }
    return <section className="scanner-card"><div className="scanner-heading"><ScanLine /><h3>مسح كود الطالب</h3></div><div id="qr-reader" className={active ? 'camera-view' : 'camera-view idle'}/>{!active && <div className="camera-placeholder"><QrIcon /><p>وجّه الكاميرا للرمز الموجود في بروفايل الطالب</p></div>}<div className="actions">{active ? <button className="secondary" onClick={() => void stop()}><Square size={17}/>إيقاف الكاميرا</button> : <button className="primary" disabled={disabled || starting} onClick={() => void start()}><Camera size={18}/>{starting ? 'جاري فتح الكاميرا…' : 'فتح الكاميرا'}</button>}</div>{message && <p className="error" role="alert">{message}</p>}{result && <div className="scan-result" role="status"><b>{result.name}</b><span>{result.duplicate ? 'الحضور مسجل بالفعل لهذا اليوم' : 'تم تسجيل الحضور بنجاح'}</span></div>}<details><summary>إدخال محتوى QR يدويًا</summary><form onSubmit={e => { e.preventDefault(); void read(manual); }}><label>محتوى الرمز<input value={manual} onChange={e => setManual(e.target.value)} dir="ltr" placeholder="madrasetna:v1:…"/></label><button className="secondary" disabled={disabled}>تسجيل الحضور</button></form></details></section>;
}
function QrIcon() { return <ScanLine size={68} strokeWidth={1}/>; }
