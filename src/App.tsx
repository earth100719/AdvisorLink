/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, FormEvent } from "react";
import { 
  UserPlus, 
  Users, 
  GraduationCap, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  X,
  Plus,
  School,
  ChevronRight,
  Users2,
  Calendar,
  LayoutGrid,
  FileDown,
  Clock
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Advisor, Group, Classroom, CLASSROOMS } from "./types";
import jsPDF from "jspdf";
import domtoimage from "dom-to-image-more";

// Firebase imports
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);

// Firestore Error Handler
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const INITIAL_ADVISORS: Advisor[] = [
  { id: "1", name: "อ.กุลณัฐ ผลอุดม" },
  { id: "2", name: "อ.วัชรพล ภาโนมัย" },
  { id: "3", name: "อ.จตุภัทร อาวัชนากร" },
  { id: "4", name: "อ.ธีระ บุญประจักษ์" },
  { id: "5", name: "อ.ภาณุศักดิ์ พวงแก้ว" },
  { id: "6", name: "อ.ชมัยภรณ์ นวลอนงค์" },
  { id: "7", name: "อ.ธีรภรณ์ ล้อมสุขา" },
];

const MAX_GROUPS_PER_ADVISOR = 4;

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<string[]>([""]);
  const [selectedClassroom, setSelectedClassroom] = useState<Classroom>(CLASSROOMS[0]);
  const [selectedAdvisorId, setSelectedAdvisorId] = useState<string>("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize Auth & Data
  useEffect(() => {
    // 1. Connection Test & Anonymous Auth
    const init = async () => {
      try {
        // Test connection
        await getDocFromServer(doc(db, 'test', 'connection')).catch(() => {});
        
        // Sign in
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth initialization failed", err);
        if (err instanceof Error && (err.message.includes('auth/admin-restricted-operation') || err.message.includes('operation-not-allowed'))) {
          alert("คำเตือน: ระบบลงทะเบียน (Auth) ยังไม่ได้เปิดใช้งานใน Firebase Console\nโปรดเปิดใช้งาน 'Anonymous Authentication' เพื่อให้สามารถลงทะเบียนได้");
        }
        // Don't keep screen loading forever if auth fails
        setIsLoading(false);
      }
    };
    init();

    // 2. Auth State Listener
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });

    // 3. Real-time Data Listener
    const q = query(collection(db, "groups"), orderBy("registeredAt", "asc"));
    const unsubscribeData = onSnapshot(q, 
      (snapshot) => {
        const fetchedGroups = snapshot.docs.map(doc => ({
          ...doc.data(),
          id: doc.id
        })) as Group[];
        setGroups(fetchedGroups);
        setIsLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, "groups");
      }
    );

    return () => {
      unsubscribeAuth();
      unsubscribeData();
    };
  }, []);

  const advisorStats = useMemo(() => {
    const stats: Record<string, number> = {};
    INITIAL_ADVISORS.forEach(a => stats[a.id] = 0);
    groups.forEach(g => {
      if (stats[g.advisorId] !== undefined) {
        stats[g.advisorId]++;
      }
    });
    return stats;
  }, [groups]);

  const handleAddMember = () => {
    if (members.length < 3) {
      setMembers([...members, ""]);
    }
  };

  const handleRemoveMember = (index: number) => {
    if (members.length > 1) {
      const newMembers = members.filter((_, i) => i !== index);
      setMembers(newMembers);
    }
  };

  const handleMemberChange = (index: number, value: string) => {
    const newMembers = [...members];
    newMembers[index] = value;
    setMembers(newMembers);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!currentUser) return alert("กรุณารอสักครู่ กำลังเชื่อมต่อระบบ...");
    
    // Basic validation
    const validMembers = members.filter(m => m.trim().length > 0);
    if (validMembers.length === 0) return alert("กรุณากรอกชื่อสมาชิก");
    if (!selectedAdvisorId) return alert("กรุณาเลือกอาจารย์ที่ปรึกษา");
    if (advisorStats[selectedAdvisorId] >= MAX_GROUPS_PER_ADVISOR) return alert("อาจารย์ท่านนี้มีกลุ่มที่ปรึกษาเต็มแล้ว");

    try {
      const groupData = {
        advisorId: selectedAdvisorId,
        members: validMembers,
        classroom: selectedClassroom,
        registeredAt: Date.now(), // Fallback, rules use request.time
        createdBy: currentUser.uid
      };

      await addDoc(collection(db, "groups"), {
        ...groupData,
        registeredAt: serverTimestamp() // Official server time
      });

      setMembers([""]);
      setSelectedAdvisorId("");
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "groups");
    }
  };

  const handleDeleteGroup = async (id: string, groupCreatorId?: string) => {
    if (!currentUser) return;
    if (groupCreatorId !== currentUser.uid) {
      return alert("คุณไม่ได้รับอนุญาตให้ลบข้อมูลนี้ (ต้องเป็นเจ้าของที่ลงทะเบียน)");
    }

    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลกลุ่มนี้?")) {
      try {
        await deleteDoc(doc(db, "groups", id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `groups/${id}`);
      }
    }
  };

  const handleExportPDF = async () => {
    if (groups.length === 0) return alert("ไม่พบข้อมูลสำหรับการส่งออก");
    
    setIsExporting(true);
    // Use the dedicated hidden template for export
    const element = document.getElementById('export-pdf-template');
    if (!element) return;

    try {
      // Temporarily show the template off-screen or in a way domtoimage can see it
      element.parentElement?.classList.remove('hidden');
      element.parentElement?.style.setProperty('position', 'absolute');
      element.parentElement?.style.setProperty('left', '-9999px');
      element.parentElement?.style.setProperty('top', '0');

      const dataUrl = await domtoimage.toPng(element, {
        quality: 1,
        bgcolor: '#ffffff',
      });
      
      // Hide the template again
      element.parentElement?.classList.add('hidden');
      element.parentElement?.style.removeProperty('position');
      element.parentElement?.style.removeProperty('left');
      element.parentElement?.style.removeProperty('top');

      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      // Calculate how many pages are needed
      let heightLeft = pdfHeight;
      let position = 0;
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(dataUrl, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`project-advisor-list-${new Date().getTime()}.pdf`);
    } catch (err) {
      console.error("PDF Export failed", err);
      alert("เกิดข้อผิดพลาดในการส่งออก PDF: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="relative min-h-screen pb-20 overflow-x-hidden">
      {/* Background Elements */}
      <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-[40%] h-[40%] bg-brand-100/50 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-5%] left-[-5%] w-[30%] h-[30%] bg-blue-100/30 blur-[100px] rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-[0.03]" 
             style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      </div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
          <Clock className="animate-spin text-brand-600" size={48} />
          <p className="text-slate-900 font-black text-xl">กำลังเชื่อมต่อฐานข้อมูล...</p>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        {/* Navigation / Hero */}
        <header className="pt-12 pb-6 space-y-6 text-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-brand-50 text-brand-600 rounded-full text-sm font-bold border border-brand-100 shadow-sm"
          >
            <GraduationCap size={18} />
            <span>Smart Advisor Matching Platform 2024</span>
          </motion.div>
          
          <div className="space-y-4">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-5xl md:text-6xl font-black tracking-tight text-slate-900"
            >
              Advisor<span className="text-brand-600">Link</span>
            </motion.h1>
            <motion.p 
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-slate-500 text-lg md:text-xl font-medium max-w-2xl mx-auto leading-relaxed"
            >
              ยกระดับการจัดการโครงงานด้วยระบบจับคู่ที่ปรึกษาที่ชาญฉลาด รวดเร็ว และโปร่งใส
            </motion.p>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: Form */}
          <motion.section 
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", damping: 20 }}
            className="lg:col-span-5 space-y-6"
          >
            <div className="glass-card rounded-[2.5rem] p-8 md:p-10 sticky top-8">
              <div className="flex items-center justify-between mb-10">
                <div className="space-y-1">
                  <h2 className="text-3xl font-black text-slate-900">ลงทะเบียน</h2>
                  <p className="text-slate-400 text-sm font-medium">กรอกข้อมูลเพื่อจองสิทธิ์ที่ปรึกษา</p>
                </div>
                <div className="w-14 h-14 bg-brand-600 shadow-lg shadow-brand-500/30 rounded-2xl flex items-center justify-center text-white rotate-3">
                  <UserPlus size={28} />
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Classroom */}
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <School size={14} className="text-brand-500" /> ห้องเรียนที่สังกัด
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {CLASSROOMS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setSelectedClassroom(c)}
                        className={`py-3 rounded-xl font-bold text-sm transition-all border ${
                          selectedClassroom === c 
                            ? 'bg-brand-600 text-white border-brand-600 shadow-md shadow-brand-200' 
                            : 'bg-white text-slate-500 border-slate-100 hover:border-brand-200'
                        }`}
                      >
                        {c.split(' ')[1]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Members */}
                <div className="space-y-3">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Users size={14} className="text-brand-500" /> สมาชิกในกลุ่ม (สูงสุด 3 คน)
                  </label>
                  <div className="space-y-3">
                    <AnimatePresence mode="popLayout" initial={false}>
                      {members.map((member, index) => (
                        <motion.div 
                          key={index}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 10 }}
                          className="relative group"
                        >
                          <input
                            type="text"
                            value={member}
                            onChange={(e) => handleMemberChange(index, e.target.value)}
                            placeholder={`ระบุชื่อสมาชิกคนที่ ${index + 1}`}
                            className="input-field pr-12 font-medium"
                            required
                          />
                          {members.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveMember(index)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <X size={16} />
                            </button>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                  {members.length < 3 && (
                    <button
                      type="button"
                      onClick={handleAddMember}
                      className="w-full py-4 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 font-bold text-sm hover:border-brand-400 hover:text-brand-600 transition-all bg-slate-50/50 flex items-center justify-center gap-2"
                    >
                      <Plus size={18} /> เพิ่มรายชื่อสมาชิก
                    </button>
                  )}
                </div>

                {/* Advisor Selection Button (Triggers Scroll/Focus if needed) */}
                <div className="space-y-4">
                  <label className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <GraduationCap size={14} className="text-brand-500" /> เลือกอาจารย์ที่ปรึกษา
                  </label>
                  
                  {selectedAdvisorId ? (
                    <div className="p-4 bg-brand-50 border border-brand-200 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-brand-600 font-bold border border-brand-100">
                          {INITIAL_ADVISORS.find(a => a.id === selectedAdvisorId)?.name.charAt(2)}
                        </div>
                        <span className="font-bold text-slate-900">
                          {INITIAL_ADVISORS.find(a => a.id === selectedAdvisorId)?.name}
                        </span>
                      </div>
                      <button 
                        type="button" 
                        onClick={() => setSelectedAdvisorId("")}
                        className="text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ) : (
                    <div className="p-4 border-2 border-dashed border-slate-200 rounded-2xl text-center">
                      <p className="text-slate-400 text-sm font-medium">กรุณาเลือกอาจารย์ด้านขวามือ</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn-primary w-full py-5 text-lg flex items-center justify-center gap-3"
                    disabled={!selectedAdvisorId}
                  >
                    ยืนยันการลงทะเบียน <ChevronRight size={22} strokeWidth={3} />
                  </button>
                </div>
              </form>
            </div>
          </motion.section>

          {/* Right Column: Cards & List */}
          <section className="lg:col-span-7 space-y-12">
            {/* Advisor Selection Grid */}
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-brand-600 border border-brand-50">
                    <LayoutGrid size={20} />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900">รายชื่ออาจารย์</h2>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-2 gap-5">
                {INITIAL_ADVISORS.map(advisor => {
                  const count = advisorStats[advisor.id];
                  const isFull = count >= MAX_GROUPS_PER_ADVISOR;
                  const isSelected = selectedAdvisorId === advisor.id;
                  const percentage = (count / MAX_GROUPS_PER_ADVISOR) * 100;
                  
                  return (
                    <motion.button
                      key={advisor.id}
                      layout
                      disabled={isFull}
                      onClick={() => !isFull && setSelectedAdvisorId(advisor.id)}
                      whileHover={{ y: isFull ? 0 : -4 }}
                      className={`relative text-left flex flex-col p-6 rounded-[2rem] border transition-all duration-300 group ${
                        isFull 
                          ? 'bg-slate-100/50 border-slate-200 opacity-60 cursor-not-allowed' 
                          : isSelected 
                            ? 'bg-brand-50 border-brand-300 shadow-xl shadow-brand-500/10' 
                            : 'bg-white border-slate-100 shadow-lg shadow-slate-200/40 hover:border-brand-200'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                          isSelected ? 'bg-brand-600 text-white scale-110' : 'bg-brand-50 text-brand-600 group-hover:bg-brand-100'
                        }`}>
                          <GraduationCap size={32} />
                        </div>
                        <div className={`px-3 py-1 rounded-full text-xs font-black tracking-tight ${
                          isFull ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'
                        }`}>
                          {isFull ? 'เต็มแล้ว' : 'ว่าง'}
                        </div>
                      </div>

                      <div className="space-y-1 mb-6">
                        <h3 className={`text-xl font-black ${isSelected ? 'text-brand-900' : 'text-slate-800'}`}>
                          {advisor.name}
                        </h3>
                        <p className="text-slate-400 text-sm font-bold flex items-center gap-1.5">
                          <Users2 size={14} /> จำนวนกลุ่ม: {count} / {MAX_GROUPS_PER_ADVISOR}
                        </p>
                      </div>

                      <div className="mt-auto space-y-2">
                        <div className="flex justify-between items-end">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ความจุ</span>
                          <span className={`text-xs font-black ${isFull ? 'text-red-500' : 'text-brand-600'}`}>
                            {Math.round(percentage)}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            className={`h-full rounded-full transition-colors duration-500 ${
                              isFull ? 'bg-red-500' : isSelected ? 'bg-brand-600' : 'bg-brand-400'
                            }`}
                          />
                        </div>
                      </div>

                      {isSelected && (
                        <motion.div 
                          layoutId="active-indicator"
                          className="absolute -top-2 -right-2 w-8 h-8 bg-brand-600 text-white rounded-full flex items-center justify-center shadow-lg border-2 border-white"
                        >
                          <CheckCircle2 size={16} strokeWidth={3} />
                        </motion.div>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* List Table */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl shadow-sm flex items-center justify-center text-slate-600 border border-slate-50">
                    <Users size={20} />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900">คิวลงทะเบียน</h2>
                </div>
                {groups.length > 0 && (
                  <button
                    onClick={handleExportPDF}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 hover:bg-slate-50 hover:border-brand-300 transition-all shadow-sm active:scale-[0.98] disabled:opacity-50"
                  >
                    {isExporting ? (
                      <>
                        <Clock className="animate-spin text-brand-500" size={18} />
                        กำลังประมวลผล...
                      </>
                    ) : (
                      <>
                        <FileDown size={18} className="text-brand-600" />
                        ส่งออก PDF
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="glass-card rounded-[2.5rem] overflow-hidden shadow-2xl shadow-slate-200/50">
                {/* Desktop Table View */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50">
                        <th className="px-6 py-6 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">ห้อง</th>
                        <th className="px-6 py-6 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">สมาชิกในกลุ่ม</th>
                        <th className="px-6 py-6 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">อาจารย์ที่ปรึกษา</th>
                        <th className="px-6 py-6 text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">เวลา</th>
                        <th className="px-6 py-4 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <AnimatePresence mode="popLayout">
                        {groups.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-24 text-center">
                              <div className="flex flex-col items-center gap-5 text-slate-300">
                                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center">
                                  <Users size={40} strokeWidth={1.5} />
                                </div>
                                <p className="font-bold text-slate-400 text-lg tracking-tight">ยังไม่พบข้อมูลการลงทะเบียนในระบบ</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          [...groups].reverse().map((group) => {
                            const advisor = INITIAL_ADVISORS.find(a => a.id === group.advisorId);
                            return (
                              <motion.tr 
                                key={group.id}
                                layout
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="hover:bg-slate-50/50 transition-colors group"
                              >
                                <td className="px-6 py-6 whitespace-nowrap">
                                  <span className="inline-flex px-3 py-1 rounded-lg bg-brand-50 text-brand-700 text-xs font-black border border-brand-100">
                                    {group.classroom}
                                  </span>
                                </td>
                                <td className="px-6 py-6">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 min-w-[2.25rem] rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                                      <Users size={16} />
                                    </div>
                                    <span className="font-bold text-slate-800 text-sm leading-relaxed">
                                      {group.members.join(", ")}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-6 whitespace-nowrap">
                                  <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 min-w-[2.25rem] rounded-xl bg-brand-50 flex items-center justify-center text-brand-600">
                                      <GraduationCap size={16} />
                                    </div>
                                    <span className="font-bold text-brand-700 text-sm">
                                      {advisor?.name}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-6 py-6 whitespace-nowrap">
                                  <div className="flex items-center gap-2 text-slate-400 text-xs font-bold">
                                    <Clock size={14} className="text-slate-300" />
                                    {new Date(group.registeredAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                                  </div>
                                </td>
                                <td className="px-6 py-6 text-center">
                                  {group.createdBy === currentUser?.uid && (
                                    <button 
                                      onClick={() => handleDeleteGroup(group.id, group.createdBy)}
                                      className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all sm:opacity-0 group-hover:opacity-100"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  )}
                                </td>
                              </motion.tr>
                            );
                          })
                        )}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="sm:hidden divide-y divide-slate-100">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {groups.length === 0 ? (
                      <div className="py-16 text-center">
                        <Users size={40} className="mx-auto text-slate-200 mb-4" />
                        <p className="text-slate-400 font-bold">ไม่พบข้อมูลการลงทะเบียน</p>
                      </div>
                    ) : (
                      [...groups].reverse().map((group) => {
                        const advisor = INITIAL_ADVISORS.find(a => a.id === group.advisorId);
                        return (
                          <motion.div
                            key={group.id}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="p-5 space-y-4"
                          >
                            <div className="flex justify-between items-start">
                              <span className="px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 text-[10px] font-black border border-brand-100 uppercase">
                                {group.classroom}
                              </span>
                              <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold">
                                <Clock size={12} />
                                {new Date(group.registeredAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                              </div>
                            </div>
                            
                            <div className="flex items-start gap-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400 shrink-0">
                                <Users size={14} />
                              </div>
                              <div className="font-bold text-slate-800 text-sm leading-relaxed">
                                {group.members.join(", ")}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 p-3 bg-brand-50/50 rounded-xl border border-brand-50">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <GraduationCap size={16} className="text-brand-500 shrink-0" />
                                <span className="font-bold text-brand-700 text-xs truncate">
                                  {advisor?.name}
                                </span>
                              </div>
                              {group.createdBy === currentUser?.uid && (
                                <button 
                                  onClick={() => handleDeleteGroup(group.id, group.createdBy)}
                                  className="p-2 text-red-500 bg-white border border-red-100 rounded-lg shrink-0 active:scale-95"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Hidden Export Template (for PDF) */}
      <div className="hidden">
        <div id="export-pdf-template" className="p-12 bg-white w-[1000px] text-slate-900">
          <div className="text-center space-y-4 mb-12 border-b pb-8">
            <h1 className="text-3xl font-black">สรุปรายชื่อกลุ่มและอาจารย์ที่ปรึกษาโครงงาน</h1>
            <p className="text-slate-500 text-lg">รายการทั้งหมด ณ วันที่ {new Date().toLocaleDateString('th-TH')} เวลา {new Date().toLocaleTimeString('th-TH')}</p>
          </div>
          
          <table className="w-full text-left border-collapse border border-slate-200">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-4 py-4 border border-slate-200 font-black text-sm">ลำดับ</th>
                <th className="px-4 py-4 border border-slate-200 font-black text-sm">ห้อง</th>
                <th className="px-4 py-4 border border-slate-200 font-black text-sm">สมาชิกในกลุ่ม</th>
                <th className="px-4 py-4 border border-slate-200 font-black text-sm">อาจารย์ที่ปรึกษา</th>
                <th className="px-4 py-4 border border-slate-200 font-black text-sm">วันเวลาที่ลงทะเบียน</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const advisor = INITIAL_ADVISORS.find(a => a.id === group.advisorId);
                return (
                  <tr key={group.id}>
                    <td className="px-4 py-4 border border-slate-200 text-sm text-center">{index + 1}</td>
                    <td className="px-4 py-4 border border-slate-200 text-sm text-center">{group.classroom}</td>
                    <td className="px-4 py-4 border border-slate-200 text-sm font-bold">{group.members.join(", ")}</td>
                    <td className="px-4 py-4 border border-slate-200 text-sm font-bold text-brand-700">{advisor?.name}</td>
                    <td className="px-4 py-4 border border-slate-200 text-sm text-slate-500">
                      {new Date(group.registeredAt).toLocaleString('th-TH')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          
          <div className="mt-12 text-sm text-slate-400 text-right italic">
            สร้างโดยระบบ AdvisorLink: Project Matching Platform
          </div>
        </div>
    </div>

      {/* Success Modal/Toast */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="bg-slate-900 text-white px-8 py-5 rounded-[2rem] shadow-2xl flex items-center gap-4 border border-white/5">
              <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white ring-4 ring-green-500/20 animate-pulse">
                <CheckCircle2 size={24} strokeWidth={3} />
              </div>
              <div className="pr-4">
                <h4 className="font-black tracking-tight text-lg">ลงทะเบียนสำเร็จ!</h4>
                <p className="text-slate-400 text-sm font-medium">ข้อมูลกลุ่มของคุณถูกบันทึกเรียบร้อย</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
