import { useState } from 'react';
import { BookOpen, QrCode, ShieldCheck, Users, ArrowLeft } from 'lucide-react';
import { supabase, configured } from '../core/client';
import { registerStudent } from '../core/api';
import { Settings, validStudent, safeError } from '../core/model';
export type Registration = {
    name: string;
    phone: string;
    username: string;
    password: string;
};
export function registrationLink() { const url = new URL(window.location.href); url.search = ''; url.hash = 'register'; return url.href; }
export function Login({ settings, onDemo, onDemoRegister }: {
    settings: Settings;
    onDemo: (student?: boolean) => void;
    onDemoRegister: (v: Registration) => void;
}) {
    const [register, setRegister] = useState(window.location.hash === '#register'), [username, setUsername] = useState(''), [pass, setPass] = useState(''), [repeat, setRepeat] = useState(''), [name, setName] = useState(''), [phone, setPhone] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
    return <main className="login-page" dir="rtl"><section className="login-brand"><div className="brand">{settings.logo ? <img src={settings.logo} alt="لوجو الدراسة"/> : <BookOpen />}<b>{settings.name}</b></div><span className="eyebrow">{settings.login_tagline ?? 'كل طالب له مكان'}</span><h1 style={{whiteSpace:'pre-line'}}>{settings.login_title ?? 'أيام بنعيشها.\nوخطوات بنكبرها.'}</h1><p>{settings.verse || 'الطلاب، الحضور، والتقييمات. كل تفاصيل الدراسة في مكان واحد.'}</p><div className="brand-features"><span><QrCode />حضور برمز خاص</span><span><Users />متابعة كل طالب</span><span><ShieldCheck />صلاحيات واضحة</span></div></section><section className="login-side"><div className="login-box"><span className="eyebrow">أهلًا بيك</span><h2>{register ? 'سجّل في الدراسة' : 'تسجيل الدخول'}</h2><p>{register ? 'سجّل بياناتك، والأدمن هيراجع طلبك ويفعّل حسابك.' : 'ادخل بيانات حسابك لمتابعة الدراسة.'}</p><form onSubmit={async (e) => { e.preventDefault(); setError(''); setSuccess(''); const login = username.trim().toLowerCase(); if (register) {
        if (!validStudent(name, phone, login)) {
            setError('راجع الاسم والموبايل واسم المستخدم.');
            return;
        }
        if (pass.length < 6 || pass !== repeat) {
            setError('كلمة المرور لازم تكون 6 أحرف على الأقل والتأكيد مطابق.');
            return;
        }
        const v = { name, phone, username: login, password: pass };
        if (!configured) {
            onDemoRegister(v);
            return;
        }
        setBusy(true);
        try {
            const r = await registerStudent(v);
            if (!r.session)
                setSuccess('تم إرسال الطلب. تواصل مع الأدمن لو واجهت مشكلة في تسجيل الدخول.');
        }
        catch (e) {
            setError(safeError(e));
        }
        finally {
            setBusy(false);
        }
        return;
    } if (!supabase)
        return; setBusy(true); try {
        const { error } = await supabase.auth.signInWithPassword({ email: login.includes('@') ? login : login + '@students.invalid', password: pass });
        if (error)
            throw error;
    }
    catch (e) {
        setError(safeError(e));
    }
    finally {
        setBusy(false);
    } }}>
    {register && <><label>اسم الطالب<input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={e => setName(e.target.value)}/></label><label>الموبايل<input required type="tel" pattern="\+?[0-9]{8,15}" dir="ltr" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value.replaceAll(' ', ''))}/></label></>}
    <label>{register ? 'اسم المستخدم' : 'اسم المستخدم أو بريد الأدمن'}<input required dir="ltr" autoComplete="username" pattern={register ? '[a-z0-9_]{3,32}' : undefined} maxLength={register ? 32 : 254} value={username} onChange={e => setUsername(e.target.value.toLowerCase())}/>{register && <small>حروف إنجليزية صغيرة وأرقام وشرطة سفلية، من 3 إلى 32 حرفًا.</small>}</label>
    <label>كلمة المرور<input required type="password" minLength={register ? 6 : undefined} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} value={pass} onChange={e => setPass(e.target.value)}/></label>{register && <label>تأكيد كلمة المرور<input required type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)}/></label>}{error && <p role="alert" className="error">{error}</p>}{success && <p role="status" className="notice">{success}</p>}<button className="primary" disabled={busy || (!register && !configured)}>{busy ? 'جاري التنفيذ…' : register ? (configured ? 'إرسال طلب التسجيل' : 'تجربة طلب التسجيل') : 'تسجيل الدخول'}<ArrowLeft size={18}/></button></form><button className="text-button login-toggle" onClick={() => { setRegister(!register); setError(''); setSuccess(''); history.replaceState(null, '', register ? '#login' : '#register'); }}>{register ? 'عندي حساب بالفعل — تسجيل الدخول' : 'طالب جديد؟ سجّل حسابك'}</button>{!register && <p className="login-help">نسيت كلمة المرور؟ تواصل مع أدمن الدراسة.</p>}{!configured && <div className="notice"><b>نسخة تجريبية مؤقتة</b><p>التسجيل هنا للتجربة، ولا ينشئ حسابًا على السحابة.</p><div className="actions wrap"><button className="secondary" onClick={() => onDemo(false)}>تجربة الأدمن</button><button className="secondary" onClick={() => onDemo(true)}>تجربة الطالب</button></div></div>}</div></section></main>;
}
