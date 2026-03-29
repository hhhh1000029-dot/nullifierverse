import React, { useState, useEffect, useCallback } from 'react';
import { 
  Search, 
  Plus, 
  Heart, 
  MessageSquare, 
  Star, 
  Download, 
  Play, 
  ArrowLeft, 
  User as UserIcon,
  LogOut,
  Filter,
  TrendingUp,
  Clock,
  HardDrive,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Upload,
  Link as LinkIcon,
  Send,
  Share2,
  Globe,
  Trash2,
  X,
  Maximize,
  Minimize
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import LZString from 'lz-string';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  onAuthStateChanged, 
  ensureUserProfile,
  User, 
  collection, 
  query, 
  where, 
  orderBy, 
  limit, 
  getDocs, 
  onSnapshot, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  increment, 
  deleteDoc,
  addDoc,
  OperationType,
  handleFirestoreError,
  onQuotaExceededChange
} from '../firebase';
import { SavedStage } from '../editor/EditorTypes';

interface WeekData {
  id: string;
  name: string;
  creatorUid: string;
  creatorName: string;
  creatorId: number;
  description: string;
  thumbnail: string;
  songs: string[];
  difficulty: number;
  likesCount: number;
  commentsCount: number;
  data: string;
  isCompressed?: boolean;
  isChunked?: boolean;
  chunkCount?: number;
  isReady?: boolean;
  createdAt: string;
}

interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  creatorId: number;
  createdAt: string;
}

interface OnlineHubProps {
  onBack: () => void;
  onPlaytest: (stage: SavedStage) => void;
}

interface Comment {
  id: string;
  uid: string;
  userName: string;
  text: string;
  createdAt: string;
}

interface Post {
  id: string;
  uid: string;
  userName: string;
  userPhoto: string;
  content: string;
  links: string[];
  likesCount: number;
  createdAt: string;
}

export const OnlineHub: React.FC<OnlineHubProps> = ({ onBack, onPlaytest }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'NEWEST' | 'MOST_LIKED' | 'MOST_COMMENTED' | 'HARDEST' | 'COMMUNITY'>('NEWEST');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedWeeks, setDownloadedWeeks] = useState<string[]>([]);
  const [likedWeeks, setLikedWeeks] = useState<Set<string>>(new Set());
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());
  const [processingLikes, setProcessingLikes] = useState<Set<string>>(new Set());
  const [commentingWeek, setCommentingWeek] = useState<WeekData | null>(null);
  const [weekToDelete, setWeekToDelete] = useState<WeekData | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      
      // Tab switching shortcuts (Alt + 1-4)
      if (e.altKey) {
        if (e.key === '1') setActiveTab('newest');
        else if (e.key === '2') setActiveTab('liked');
        else if (e.key === '3') setActiveTab('trending');
        else if (e.key === '4') setActiveTab('my-stages');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      document.exitFullscreen();
    }
  };
  
  // Post creation state
  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [postLinks, setPostLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState('');

  useEffect(() => {
    // Load downloaded weeks from localStorage
    const saved = localStorage.getItem('downloaded_weeks');
    if (saved) {
      try {
        setDownloadedWeeks(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading downloaded weeks', e);
      }
    }
  }, []);

  const saveDownloadedWeeks = (ids: string[]) => {
    setDownloadedWeeks(ids);
    localStorage.setItem('downloaded_weeks', JSON.stringify(ids));
  };

  useEffect(() => {
    return onQuotaExceededChange(setQuotaExceeded);
  }, []);

  const markAsDownloaded = (id: string) => {
    if (!downloadedWeeks.includes(id)) {
      saveDownloadedWeeks([...downloadedWeeks, id]);
    }
  };

  const removeLocalDownload = (id: string) => {
    saveDownloadedWeeks(downloadedWeeks.filter(wid => wid !== id));
    showNotification('Level removed from local storage.');
  };

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const profileData = await ensureUserProfile(u);
          if (profileData) {
            setProfile(profileData as UserProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
          console.error('Error ensuring profile:', error);
        }
      } else {
        setProfile(null);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    setLoading(true);
    
    if (activeTab === 'COMMUNITY') {
      const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const postsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Post));
        setPosts(postsData);
        setLoading(false);

        if (user) {
          const fetchPostLikes = async () => {
            try {
              const newLikedPosts = new Set<string>();
              for (const p of postsData) {
                const likeDoc = await getDoc(doc(db, 'posts', p.id, 'likes', user.uid));
                if (likeDoc.exists()) {
                  newLikedPosts.add(p.id);
                }
              }
              setLikedPosts(newLikedPosts);
            } catch (error) {
              handleFirestoreError(error, OperationType.GET, 'posts/likes');
            }
          };
          fetchPostLikes();
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'posts');
        setLoading(false);
      });
      return unsubscribe;
    }

    let q = query(collection(db, 'weeks'));

    switch (activeTab) {
      case 'NEWEST':
        q = query(collection(db, 'weeks'), orderBy('createdAt', 'desc'), limit(20));
        break;
      case 'MOST_LIKED':
        q = query(collection(db, 'weeks'), orderBy('likesCount', 'desc'), limit(20));
        break;
      case 'MOST_COMMENTED':
        q = query(collection(db, 'weeks'), orderBy('commentsCount', 'desc'), limit(20));
        break;
      case 'HARDEST':
        q = query(collection(db, 'weeks'), orderBy('difficulty', 'desc'), limit(20));
        break;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const weeksData = snapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as WeekData))
        .filter(w => w.isReady !== false); // Filter out incomplete uploads client-side
      setWeeks(weeksData);
      setLoading(false);

      // Fetch user's liked status for all visible weeks in one go if possible
      // or at least more efficiently
      if (user) {
        const fetchLikes = async () => {
          try {
            const newLikedWeeks = new Set<string>();
            for (const w of weeksData) {
              const likeDoc = await getDoc(doc(db, 'weeks', w.id, 'likes', user.uid));
              if (likeDoc.exists()) {
                newLikedWeeks.add(w.id);
              }
            }
            setLikedWeeks(newLikedWeeks);
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, 'weeks/likes');
          }
        };
        fetchLikes();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'weeks');
      setLoading(false);
    });

    return unsubscribe;
  }, [activeTab, user]);

  const handleDownloadAndPlay = async (week: WeekData) => {
    setDownloadingId(week.id);
    setDownloadProgress(0);
    try {
      let fullData = '';
      
      if (week.isChunked) {
        // Fetch all chunks at once to be more resilient to ID mismatches
        const chunksRef = collection(db, 'weeks', week.id, 'chunks');
        const chunksSnapshot = await getDocs(chunksRef);
        
        if (chunksSnapshot.empty) {
          console.warn(`No chunks found for week ${week.id} even though isChunked is true. Falling back to main doc data.`);
          // Fallback: maybe it's not actually chunked or data is in the main doc
          fullData = week.data || '';
        } else {
          // Sort chunks by index field
          const sortedDocs = [...chunksSnapshot.docs].sort((a, b) => {
            const idxA = a.data().index || 0;
            const idxB = b.data().index || 0;
            return idxA - idxB;
          });
          
          if (week.chunkCount && sortedDocs.length < week.chunkCount) {
            console.warn(`Missing some chunks. Expected ${week.chunkCount}, got ${sortedDocs.length}. Attempting to play anyway...`);
          }
          
          const chunkData: string[] = [];
          for (let i = 0; i < sortedDocs.length; i++) {
            // We already have the data in the snapshot, but we iterate to show progress
            chunkData.push(sortedDocs[i].data().data || '');
            setDownloadProgress(Math.round(((i + 1) / sortedDocs.length) * 100));
            // Small delay to make progress visible if it's too fast
            if (sortedDocs.length > 10) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          
          fullData = chunkData.join('');
        }
      } else {
        fullData = week.data || '';
        setDownloadProgress(100);
      }

      if (!fullData || fullData.length < 10) {
        console.error('Level data is missing or too short:', fullData?.length);
        throw new Error('This level appears to be an incomplete or broken upload. Please try another one.');
      }

      let stageData: SavedStage;
      
      if (week.isCompressed) {
        let decompressed: string | null = null;
        
        // Safety check: if it looks like JSON already, don't decompress
        if (fullData.trim().startsWith('{')) {
          console.warn('Data is marked as compressed but looks like raw JSON. Skipping decompression.');
          decompressed = fullData;
        } else {
          try {
            // Try Base64 first (new format)
            decompressed = LZString.decompressFromBase64(fullData);
            
            // Fallback to UTF16 for older uploads if Base64 fails
            if (!decompressed && fullData.length > 0) {
              decompressed = LZString.decompressFromUTF16(fullData);
            }
          } catch (e) {
            console.error('Decompression error:', e);
            // Fallback to UTF16 if Base64 throws
            decompressed = LZString.decompressFromUTF16(fullData);
          }
        }

        if (!decompressed) {
          console.error('Failed to decompress. Data length:', fullData.length, 'Prefix:', fullData.substring(0, 20));
          throw new Error('Failed to decompress stage data. The upload might be corrupted.');
        }

        try {
          stageData = JSON.parse(decompressed) as SavedStage;
        } catch (e) {
          console.error('JSON parse error after decompression:', e);
          throw new Error('Decompressed data is not valid JSON.');
        }
      } else {
        try {
          stageData = JSON.parse(fullData) as SavedStage;
        } catch (e) {
          console.error('JSON parse error (uncompressed):', e);
          throw new Error('Level data is not valid JSON.');
        }
      }
      
      // Ensure it has a unique ID for local session
      stageData.id = 'online-' + week.id;
      
      markAsDownloaded(week.id);
      
      setTimeout(() => {
        setDownloadingId(null);
        setDownloadProgress(0);
        onPlaytest(stageData);
      }, 1000);
    } catch (error) {
      console.error('Download error:', error);
      showNotification('Failed to download week.', 'error');
      setDownloadingId(null);
      setDownloadProgress(0);
      try {
        handleFirestoreError(error, OperationType.GET, `weeks/${week.id}`);
      } catch (e) {}
    }
  };

  const handleLike = async (weekId: string) => {
    if (!user) {
      showNotification('Please login to like!', 'error');
      return;
    }

    if (processingLikes.has(weekId)) return;
    setProcessingLikes(prev => new Set(prev).add(weekId));

    const likeRef = doc(db, 'weeks', weekId, 'likes', user.uid);
    const weekRef = doc(db, 'weeks', weekId);

    try {
      const likeDoc = await getDoc(likeRef);
      if (likeDoc.exists()) {
        await deleteDoc(likeRef);
        await updateDoc(weekRef, { likesCount: increment(-1) });
        setLikedWeeks(prev => {
          const next = new Set(prev);
          next.delete(weekId);
          return next;
        });
      } else {
        await setDoc(likeRef, { uid: user.uid, weekId, createdAt: new Date().toISOString() });
        await updateDoc(weekRef, { likesCount: increment(1) });
        setLikedWeeks(prev => new Set(prev).add(weekId));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `weeks/${weekId}`);
    } finally {
      setProcessingLikes(prev => {
        const next = new Set(prev);
        next.delete(weekId);
        return next;
      });
    }
  };

  const handleDeleteFromHub = async () => {
    if (!user || !weekToDelete) return;
    
    setIsDeleting(true);
    try {
      // Delete chunks if they exist (MUST be done before deleting main doc due to security rules)
      if (weekToDelete.isChunked && weekToDelete.chunkCount) {
        for (let i = 0; i < weekToDelete.chunkCount; i++) {
          try {
            await deleteDoc(doc(db, 'weeks', weekToDelete.id, 'chunks', i.toString()));
          } catch (e) {
            handleFirestoreError(e, OperationType.DELETE, `weeks/${weekToDelete.id}/chunks/${i}`);
            console.warn(`Failed to delete chunk ${i}:`, e);
          }
        }
      }

      await deleteDoc(doc(db, 'weeks', weekToDelete.id));
      showNotification('Level deleted from Online Hub.', 'success');
      setWeekToDelete(null);
    } catch (error) {
      showNotification('Failed to delete level.', 'error');
      try {
        handleFirestoreError(error, OperationType.DELETE, `weeks/${weekToDelete.id}`);
      } catch (e) {}
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreatePost = async () => {
    if (!user || !postContent.trim()) return;
    
    setIsCreatingPost(true);
    try {
      const postId = crypto.randomUUID();
      const postData: Post = {
        id: postId,
        uid: user.uid,
        userName: user.displayName || 'Anonymous',
        userPhoto: user.photoURL || '',
        content: postContent.trim(),
        links: postLinks,
        likesCount: 0,
        createdAt: new Date().toISOString()
      };
      
      await setDoc(doc(db, 'posts', postId), postData);
      setPostContent('');
      setPostLinks([]);
      showNotification('Post shared with the community!');
    } catch (error) {
      showNotification('Failed to share post.', 'error');
      try {
        handleFirestoreError(error, OperationType.CREATE, 'posts');
      } catch (e) {}
    } finally {
      setIsCreatingPost(false);
    }
  };

  const handlePostLike = async (postId: string) => {
    if (!user) {
      showNotification('Please login to like!', 'error');
      return;
    }

    if (processingLikes.has(postId)) return;
    setProcessingLikes(prev => new Set(prev).add(postId));

    const likeRef = doc(db, 'posts', postId, 'likes', user.uid);
    const postRef = doc(db, 'posts', postId);

    try {
      const likeDoc = await getDoc(likeRef);
      if (likeDoc.exists()) {
        await deleteDoc(likeRef);
        await updateDoc(postRef, { likesCount: increment(-1) });
        setLikedPosts(prev => {
          const next = new Set(prev);
          next.delete(postId);
          return next;
        });
      } else {
        await setDoc(likeRef, { uid: user.uid, postId, createdAt: new Date().toISOString() });
        await updateDoc(postRef, { likesCount: increment(1) });
        setLikedPosts(prev => new Set(prev).add(postId));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
    } finally {
      setProcessingLikes(prev => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  };

  const handleAddLink = () => {
    if (!newLink.trim()) return;
    if (!newLink.startsWith('http')) {
      showNotification('Link must start with http:// or https://', 'error');
      return;
    }
    if (postLinks.length >= 5) {
      showNotification('Maximum 5 links allowed.', 'error');
      return;
    }
    setPostLinks([...postLinks, newLink.trim()]);
    setNewLink('');
  };

  const removeLink = (idx: number) => {
    setPostLinks(postLinks.filter((_, i) => i !== idx));
  };

  const filteredWeeks = weeks.filter(w => 
    w.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.creatorName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex flex-col overflow-hidden font-sans">
      {/* Top Bar */}
      <div className="bg-zinc-900/50 backdrop-blur-xl border-b border-white/10 px-8 py-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-8">
          <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-xl transition-all active:scale-95">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-4xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500">
            ONLINE HUB
          </h1>
          
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-cyan-400 transition-colors" />
            <input 
              type="text" 
              placeholder="Search weeks, creators, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-800/50 border border-white/5 rounded-2xl pl-12 pr-6 py-3 w-96 focus:ring-2 focus:ring-cyan-500/50 outline-none transition-all placeholder:text-zinc-600"
            />
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              setLoading(true);
              // ActiveTab change or same tab will re-trigger effect
              const currentTab = activeTab;
              setActiveTab('' as any);
              setTimeout(() => setActiveTab(currentTab), 10);
            }}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title="Refresh"
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
          <button 
            onClick={toggleFullscreen}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          {user ? (
            <div className="flex items-center gap-4 bg-zinc-800/50 p-1.5 pr-4 rounded-2xl border border-white/5">
              <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-xl border border-white/10" />
              <div className="flex flex-col">
                <span className="text-sm font-bold">{user.displayName}</span>
                <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">ID: #{profile?.creatorId || '...'}</span>
              </div>
              <button onClick={logout} className="ml-2 p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button 
              onClick={loginWithGoogle}
              className="flex items-center gap-2 px-6 py-3 bg-white text-black rounded-2xl font-black hover:bg-zinc-200 transition-all active:scale-95 shadow-xl shadow-white/10"
            >
              <UserIcon className="w-5 h-5" />
              LOGIN WITH GOOGLE
            </button>
          )}
        </div>
      </div>

      {/* Quota Warning */}
      <AnimatePresence>
        {quotaExceeded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-red-600 text-white px-6 py-3 flex items-center justify-between gap-4 overflow-hidden"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="w-5 h-5" />
              <span className="text-sm font-bold">Firestore daily quota exceeded. Uploads and likes are temporarily disabled.</span>
            </div>
            <button 
              onClick={() => setQuotaExceeded(false)}
              className="p-1 hover:bg-white/20 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Tabs */}
        <div className="w-72 bg-zinc-900/30 border-r border-white/5 p-6 flex flex-col gap-2">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 px-4">Browse</span>
          <TabButton active={activeTab === 'NEWEST'} onClick={() => setActiveTab('NEWEST')} icon={<Clock className="w-5 h-5" />} label="Newest" />
          <TabButton active={activeTab === 'MOST_LIKED'} onClick={() => setActiveTab('MOST_LIKED')} icon={<TrendingUp className="w-5 h-5" />} label="Most Liked" />
          <TabButton active={activeTab === 'MOST_COMMENTED'} onClick={() => setActiveTab('MOST_COMMENTED')} icon={<MessageSquare className="w-5 h-5" />} label="Most Commented" />
          <TabButton active={activeTab === 'HARDEST'} onClick={() => setActiveTab('HARDEST')} icon={<HardDrive className="w-5 h-5" />} label="Hardest" />
          <TabButton active={activeTab === 'COMMUNITY'} onClick={() => setActiveTab('COMMUNITY')} icon={<Globe className="w-5 h-5" />} label="Community" />
          
          <div className="mt-auto p-6 bg-gradient-to-br from-pink-500/10 to-transparent rounded-3xl border border-pink-500/20">
            <h3 className="font-black italic text-pink-400 mb-2">SHARE YOUR WEEK</h3>
            <p className="text-xs text-zinc-400 mb-4">Upload your creations from the Editor to the community.</p>
            <button className="w-full py-3 bg-pink-600 hover:bg-pink-500 rounded-xl font-bold transition-all active:scale-95 shadow-lg shadow-pink-600/20 flex items-center justify-center gap-2">
              <Plus className="w-4 h-4" />
              UPLOAD NOW
            </button>
          </div>
        </div>

        {/* Level Grid / Community Feed */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500">
              <Loader2 className="w-12 h-12 animate-spin mb-4 text-cyan-400" />
              <p className="font-bold uppercase tracking-widest">Loading the Hub...</p>
            </div>
          ) : activeTab === 'COMMUNITY' ? (
            <div className="max-w-4xl mx-auto space-y-8">
              {/* Create Post Section */}
              <div className="bg-zinc-900 border border-white/10 rounded-3xl p-6 shadow-2xl">
                <div className="flex gap-4 mb-4">
                  <img src={user?.photoURL || ''} alt="" className="w-12 h-12 rounded-xl border border-white/10" />
                  <textarea 
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    placeholder="What's on your mind? Share a link or a thought..."
                    className="flex-1 bg-zinc-800/50 border border-white/5 rounded-2xl p-4 outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all resize-none h-32"
                  />
                </div>
                
                {/* Links Preview */}
                {postLinks.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4 ml-16">
                    {postLinks.map((link, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-zinc-800 px-3 py-1.5 rounded-full text-xs border border-white/5">
                        <LinkIcon className="w-3 h-3 text-cyan-400" />
                        <span className="text-zinc-300 truncate max-w-[200px]">{link}</span>
                        <button onClick={() => removeLink(idx)} className="hover:text-red-400">X</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between ml-16">
                  <div className="flex items-center gap-2 flex-1 max-w-md">
                    <div className="relative flex-1">
                      <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                      <input 
                        type="text" 
                        value={newLink}
                        onChange={(e) => setNewLink(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddLink()}
                        placeholder="Add a link (http://...)"
                        className="w-full bg-zinc-800/50 border border-white/5 rounded-xl pl-10 pr-4 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-500/30"
                      />
                    </div>
                    <button 
                      onClick={handleAddLink}
                      className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <button 
                    onClick={handleCreatePost}
                    disabled={isCreatingPost || !postContent.trim() || quotaExceeded}
                    className="flex items-center gap-2 px-8 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-2xl font-black transition-all active:scale-95 shadow-lg shadow-cyan-600/20"
                  >
                    {isCreatingPost ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                    SHARE POST
                  </button>
                </div>
              </div>

              {/* Community Feed */}
              <div className="space-y-6">
                {posts.length === 0 ? (
                  <div className="text-center py-20 text-zinc-600">
                    <Globe className="w-16 h-16 mx-auto mb-4 opacity-20" />
                    <p className="text-xl font-medium">No community posts yet. Be the first to share!</p>
                  </div>
                ) : (
                  posts.map(post => (
                    <PostCard 
                      key={post.id} 
                      post={post} 
                      isLiked={likedPosts.has(post.id)}
                      onLike={() => handlePostLike(post.id)}
                    />
                  ))
                )}
              </div>
            </div>
          ) : filteredWeeks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500">
              <AlertCircle className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-xl font-medium">No weeks found matching your search.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
              {filteredWeeks.map(week => (
                <WeekCard 
                  key={week.id} 
                  week={week} 
                  onLike={() => !quotaExceeded && handleLike(week.id)}
                  onDownload={() => handleDownloadAndPlay(week)}
                  onComment={() => setCommentingWeek(week)}
                  onDeleteLocal={() => removeLocalDownload(week.id)}
                  onDeleteFromHub={() => setWeekToDelete(week)}
                  isDownloading={downloadingId === week.id}
                  downloadProgress={downloadProgress}
                  isLiked={likedWeeks.has(week.id)}
                  isDownloaded={downloadedWeeks.includes(week.id)}
                  isOwner={user?.uid === week.creatorUid}
                  isProcessingLike={processingLikes.has(week.id)}
                  isQuotaExceeded={quotaExceeded}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comments Modal */}
      <AnimatePresence>
        {commentingWeek && (
          <CommentsModal 
            week={commentingWeek} 
            user={user} 
            onClose={() => setCommentingWeek(null)} 
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {weekToDelete && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeleting && setWeekToDelete(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-red-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-2xl font-black uppercase tracking-tight mb-2">Delete Level?</h3>
                <p className="text-zinc-400 mb-8">
                  Are you sure you want to delete <span className="text-white font-bold">"{weekToDelete.name}"</span> from the Online Hub? This action cannot be undone.
                </p>
                
                <div className="flex gap-4">
                  <button 
                    onClick={() => setWeekToDelete(null)}
                    disabled={isDeleting}
                    className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 rounded-2xl font-black uppercase tracking-widest transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleDeleteFromHub}
                    disabled={isDeleting}
                    className="flex-1 py-4 bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-2xl font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20 flex items-center justify-center gap-2"
                  >
                    {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                    {isDeleting ? 'DELETING...' : 'DELETE'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Notifications */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className={`fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl font-bold shadow-2xl z-[100] flex items-center gap-3 border ${
              notification.type === 'success' 
                ? 'bg-zinc-900 text-green-400 border-green-500/30' 
                : 'bg-zinc-900 text-red-400 border-red-500/30'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TabButton: React.FC<{ active: boolean, onClick: () => void, icon: React.ReactNode, label: string }> = ({ active, onClick, icon, label }) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-4 px-4 py-4 rounded-2xl transition-all group ${
      active 
        ? 'bg-white text-black font-black shadow-xl shadow-white/5' 
        : 'text-zinc-500 hover:bg-white/5 hover:text-white'
    }`}
  >
    <div className={`${active ? 'text-black' : 'text-zinc-500 group-hover:text-cyan-400'} transition-colors`}>
      {icon}
    </div>
    <span className="uppercase tracking-widest text-xs">{label}</span>
    {active && <ChevronRight className="ml-auto w-4 h-4" />}
  </button>
);

const WeekCard: React.FC<{ 
  week: WeekData, 
  onLike: () => void, 
  onDownload: () => void, 
  onComment: () => void,
  onDeleteLocal: () => void,
  onDeleteFromHub?: () => void,
  isDownloading: boolean,
  downloadProgress: number,
  isLiked: boolean,
  isDownloaded: boolean,
  isOwner: boolean,
  isProcessingLike?: boolean,
  isQuotaExceeded?: boolean
}> = ({ week, onLike, onDownload, onComment, onDeleteLocal, onDeleteFromHub, isDownloading, downloadProgress, isLiked, isDownloaded, isOwner, isProcessingLike, isQuotaExceeded }) => (
  <motion.div 
    layout
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-zinc-900 border border-white/5 rounded-3xl overflow-hidden hover:border-white/20 transition-all group"
  >
    <div className="relative aspect-video overflow-hidden">
      <img src={week.thumbnail} alt={week.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700" referrerPolicy="no-referrer" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
      
      <div className="absolute top-4 left-4 flex gap-2">
        <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-cyan-400 border border-white/10 flex items-center gap-1">
          <Star className="w-3 h-3 fill-cyan-400" />
          {week.difficulty}/10
        </div>
        <div className="bg-black/60 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-pink-400 border border-white/10">
          {week.songs.length} SONGS
        </div>
        {isDownloaded && (
          <div className="bg-green-500/80 backdrop-blur-md px-3 py-1 rounded-full text-[10px] font-black text-white border border-white/10 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            PLAYED
          </div>
        )}
      </div>

      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
        {isDownloaded && (
          <button 
            onClick={(e) => { e.stopPropagation(); onDeleteLocal(); }}
            className="p-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 rounded-xl backdrop-blur-md border border-white/10 transition-all"
            title="Delete Local Data"
          >
            <HardDrive className="w-4 h-4" />
          </button>
        )}
        {isOwner && (
          <button 
            onClick={(e) => { e.stopPropagation(); onDeleteFromHub?.(); }}
            className="p-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-xl backdrop-blur-md border border-red-500/30 transition-all"
            title="Delete from Hub"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>

    <div className="p-6">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-xl font-black italic uppercase tracking-tight leading-none mb-1">{week.name}</h3>
          <p className="text-xs text-zinc-500 font-medium">by <span className="text-zinc-300">@{week.creatorName}</span> <span className="text-[10px] text-zinc-600">#{week.creatorId}</span></p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onLike} 
            disabled={isProcessingLike || isQuotaExceeded}
            className={`flex flex-col items-center group/btn disabled:opacity-50`}
          >
            {isProcessingLike ? (
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            ) : (
              <Heart className={`w-5 h-5 ${isLiked ? 'text-pink-500 fill-pink-500' : 'text-zinc-500'} group-hover/btn:text-pink-500 transition-all`} />
            )}
            <span className="text-[10px] font-bold text-zinc-600">{week.likesCount}</span>
          </button>
          <button onClick={onComment} className="flex flex-col items-center group/btn">
            <MessageSquare className="w-5 h-5 text-zinc-500 group-hover/btn:text-cyan-500 transition-all" />
            <span className="text-[10px] font-bold text-zinc-600">{week.commentsCount}</span>
          </button>
        </div>
      </div>

      <p className="text-sm text-zinc-400 line-clamp-2 mb-6 h-10">{week.description || 'No description provided.'}</p>

      <div className="relative">
        <button 
          onClick={onDownload}
          disabled={isDownloading}
          className={`w-full py-4 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg ${
            isDownloading 
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed overflow-hidden' 
              : isDownloaded
                ? 'bg-zinc-800 hover:bg-zinc-700 text-white shadow-zinc-900/20'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
          }`}
        >
          {isDownloading ? (
            <div className="relative z-10 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin" />
              DOWNLOADING {downloadProgress}%
            </div>
          ) : isDownloaded ? (
            <>
              <Play className="w-5 h-5 fill-white" />
              PLAY AGAIN
            </>
          ) : (
            <>
              <Download className="w-5 h-5" />
              DOWNLOAD & PLAY
            </>
          )}
          
          {isDownloading && (
            <motion.div 
              className="absolute inset-0 bg-cyan-600/20 origin-left"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: downloadProgress / 100 }}
              transition={{ duration: 0.1 }}
            />
          )}
        </button>
      </div>
    </div>
  </motion.div>
);

const PostCard: React.FC<{ 
  post: Post, 
  isLiked: boolean, 
  onLike: () => void,
  isProcessingLike?: boolean,
  isQuotaExceeded?: boolean
}> = ({ post, isLiked, onLike, isProcessingLike, isQuotaExceeded }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-zinc-900 border border-white/10 rounded-3xl p-6 hover:border-white/20 transition-all"
  >
    <div className="flex gap-4">
      <img src={post.userPhoto || ''} alt="" className="w-12 h-12 rounded-xl border border-white/10" />
      <div className="flex-1">
        <div className="flex items-center justify-between mb-1">
          <span className="font-black italic uppercase tracking-tight text-cyan-400">@{post.userName}</span>
          <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">{new Date(post.createdAt).toLocaleString()}</span>
        </div>
        
        <p className="text-zinc-300 leading-relaxed mb-4 whitespace-pre-wrap">{post.content}</p>
        
        {post.links && post.links.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4">
            {post.links.map((link, idx) => (
              <a 
                key={idx} 
                href={link} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-zinc-800/50 hover:bg-cyan-500/10 px-4 py-2 rounded-xl text-xs font-bold text-cyan-400 border border-cyan-500/20 transition-all group"
              >
                <LinkIcon className="w-3 h-3 group-hover:scale-110 transition-transform" />
                <span className="truncate max-w-[250px]">{link}</span>
                <Share2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </a>
            ))}
          </div>
        )}
        
        <div className="flex items-center gap-6 pt-4 border-t border-white/5">
          <button 
            onClick={onLike}
            disabled={isProcessingLike || isQuotaExceeded}
            className={`flex items-center gap-2 group transition-all disabled:opacity-50 ${isLiked ? 'text-pink-500' : 'text-zinc-500 hover:text-pink-500'}`}
          >
            {isProcessingLike ? (
              <Loader2 className="w-5 h-5 animate-spin text-zinc-500" />
            ) : (
              <Heart className={`w-5 h-5 ${isLiked ? 'fill-pink-500' : ''} group-hover:scale-110 transition-transform`} />
            )}
            <span className="font-black text-xs">{post.likesCount}</span>
          </button>
          
          <button className="flex items-center gap-2 text-zinc-500 hover:text-cyan-400 transition-all">
            <MessageSquare className="w-5 h-5" />
            <span className="font-black text-xs">REPLY</span>
          </button>
        </div>
      </div>
    </div>
  </motion.div>
);

const CommentsModal: React.FC<{ week: WeekData, user: User | null, onClose: () => void }> = ({ week, user, onClose }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'weeks', week.id, 'comments'), orderBy('createdAt', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setComments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Comment)));
      setLoading(false);
    });
    return unsubscribe;
  }, [week.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newComment.trim() || submitting) return;

    setSubmitting(true);
    try {
      const commentId = crypto.randomUUID();
      const commentData = {
        id: commentId,
        weekId: week.id,
        uid: user.uid,
        userName: user.displayName || 'Anonymous',
        text: newComment.trim(),
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'weeks', week.id, 'comments', commentId), commentData);
      await updateDoc(doc(db, 'weeks', week.id), { commentsCount: increment(1) });
      setNewComment('');
    } catch (error) {
      console.error('Error adding comment:', error);
      try {
        handleFirestoreError(error, OperationType.CREATE, `weeks/${week.id}/comments`);
      } catch (e) {}
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-zinc-900 border border-white/10 w-full max-w-2xl rounded-3xl overflow-hidden flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black italic uppercase tracking-tight">Comments</h2>
            <p className="text-xs text-zinc-500">Discussion for <span className="text-cyan-400">{week.name}</span></p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-xl transition-colors">
            <ArrowLeft className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-4 custom-scrollbar">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-700" />
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-12 text-zinc-600">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>No comments yet. Be the first to say something!</p>
            </div>
          ) : (
            comments.map(comment => (
              <div key={comment.id} className="bg-zinc-800/50 p-4 rounded-2xl border border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-cyan-400">@{comment.userName}</span>
                  <span className="text-[10px] text-zinc-500">{new Date(comment.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{comment.text}</p>
              </div>
            ))
          )}
        </div>

        <div className="p-6 bg-zinc-950/50 border-t border-white/5">
          {user ? (
            <form onSubmit={handleSubmit} className="flex gap-4">
              <input 
                type="text" 
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 bg-zinc-800 border border-white/5 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all"
              />
              <button 
                type="submit"
                disabled={submitting || !newComment.trim()}
                className="px-6 py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-800 disabled:text-zinc-600 rounded-xl font-bold transition-all active:scale-95"
              >
                {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'POST'}
              </button>
            </form>
          ) : (
            <div className="text-center py-2 text-zinc-500 text-sm">
              Please login to post a comment.
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
