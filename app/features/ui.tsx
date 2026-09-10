import { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
export function Modal({ title, description, children, onClose, wide = false }: {
    title: string;
    description?: string;
    children: ReactNode;
    onClose: () => void;
    wide?: boolean;
}) { return <Dialog open onOpenChange={v => !v && onClose()}><DialogContent dir="rtl" className={wide ? 'modal-wide' : ''}><DialogTitle className="text-right pr-7">{title}</DialogTitle><DialogDescription className="text-right">{description || 'راجع البيانات ثم احفظ التغييرات.'}</DialogDescription>{children}</DialogContent></Dialog>; }
export function Picker({ value, onChange, options, label }: {
    value: string;
    onChange: (s: string) => void;
    options: {
        value: string;
        label: string;
    }[];
    label: string;
}) { return <Select dir="rtl" value={value || undefined} onValueChange={onChange}><SelectTrigger aria-label={label} className="picker"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>; }
export function Confirm({ title, description, action, onClose }: {
    title: string;
    description: string;
    action: () => void;
    onClose: () => void;
}) { return <AlertDialog open onOpenChange={v => !v && onClose()}><AlertDialogContent dir="rtl"><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription><AlertDialogFooter><AlertDialogCancel onClick={onClose}>رجوع</AlertDialogCancel><AlertDialogAction onClick={() => { onClose(); action(); }}>تأكيد</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>; }
export function Empty({ title, children }: {
    title: string;
    children?: ReactNode;
}) { return <div className="empty"><h3>{title}</h3>{children && <p>{children}</p>}</div>; }
