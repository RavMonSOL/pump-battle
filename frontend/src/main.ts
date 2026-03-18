const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

createApp({
  setup() {
    // Card state
    const imagePreview = ref(null);
    const cardName = ref('');
    const cardDescription = ref('');
    const cardRarity = ref('common');
    const cardAttack = ref(1000);
    const cardDefense = ref(800);
    const cardType = ref('runner');
    const cardAbility = ref(null);
    const cardResistance = ref(null);
    const isGenerating = ref(false);
    const downloadReady = ref(false);
    const generatedImage = ref(null);
    const rarityColors = {
      common: '#9ca3af', uncommon: '#22c55e', rare: '#3b82f6', epic: '#a855f7', legendary: '#f59e0b',
      dank: '#10b981', 'mega-dank': '#8b5cf6', 'ultra-dank': '#f59e0b', based: '#3b82f6',
      chad: '#ef4444', king: '#f59e0b', queen: '#ec4899'
    };
    // Game state
    const leaderboard = ref([]);
    const currentPot = ref(0);
    const timeLeft = ref(0);
    const loading = ref(false);
    const launchStatus = ref('');
    const launchResult = ref(null);
    const tickerInput = ref('');

    // Helper methods
    const handleImageUpload = (event) => {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          imagePreview.value = e.target.result;
          downloadReady.value = false;
          launchResult.value = null;
        };
        reader.readAsDataURL(file);
      }
    };

    const generateRandomAttributes = () => {
      const rarities = ['common','uncommon','rare','epic','legendary'];
      const types = ['runner','slop','degen','whale','ape','hodler','paperhands','diamondhands','fudder','vampire','npc','chad','maxi','bot','flipper','sniper','farmer','yield'];
      const abilities = [null,'HODL','Diamond Hands','Rug Pull','Pump','Dump','Whale Accumulate','FUD Shield','Vampire Bite','Degen Loan','Margin Call','Stake Rewards','Yield Farmer','Airdrop','Snipe','WAGMI','NGMI','GM','HFSP'];
      const resistances = [null,{name:'FUD RESIST',value:'-50'},{name:'FUD IMMUNE',value:'-90'},{name:'VAMP-RESIST',value:'65%'},{name:'RUG-PROOF',value:'100%'},{name:'PUMP PROT',value:'+30% ATK'},{name:'WHALE SHIELD',value:'-40% DMG'},{name:'APY-BOOST',value:'+2.5x'}];
      const rarity = rarities[Math.floor(Math.random()*rarities.length)];
      const type = types[Math.floor(Math.random()*types.length)];
      let atk = 1000 + Math.floor(Math.random()*1000);
      let def = 800 + Math.floor(Math.random()*800);
      if (rarity==='epic'||rarity==='legendary') { atk = Math.floor(atk*1.5); def = Math.floor(def*1.5); }
      const typeL = type.toLowerCase();
      if (['runner','sniper','degen'].includes(typeL)) { atk = Math.floor(atk*1.2); def = Math.floor(def*0.9); }
      else if (['hodler','diamondhands','whale'].includes(typeL)) { atk = Math.floor(atk*1.1); def = Math.floor(def*1.2); }
      else if (['paperhands','fudder'].includes(typeL)) { atk = Math.floor(atk*0.85); def = Math.floor(def*0.85); }
      let ability = null; if (Math.random() > (rarity==='common'?0.7:0.3)) ability = abilities[Math.floor(Math.random()*abilities.length)];
      let resistance = null; if (Math.random() > (rarity==='common'||rarity==='uncommon'||rarity==='degen'?0.8:0.4)) resistance = resistances[Math.floor(Math.random()*resistances.length)];
      return { rarity, type, ability, resistance, attack: atk, defense: def };
    };

    const generateCard = async () => {
      if (!imagePreview.value) { alert('Upload an image first'); return; }
      isGenerating.value = true;
      try {
        const attrs = generateRandomAttributes();
        cardName.value = 'LEGENDARY CARD';
        cardDescription.value = `A ${attrs.type} of the ${attrs.rarity} tier.${attrs.ability?` Ability: ${attrs.ability}.`:''}${attrs.resistance?` Resists ${attrs.resistance.name}.`:''}`;
        cardRarity.value = attrs.rarity;
        cardType.value = attrs.type;
        cardAbility.value = attrs.ability;
        cardResistance.value = attrs.resistance;
        cardAttack.value = attrs.attack;
        cardDefense.value = attrs.defense;
        // Render card to image
        const cardElement = document.getElementById('tcg-card-preview');
        if (!cardElement) throw new Error('Card element not found');
        const canvas = await html2canvas(cardElement, { backgroundColor: null, scale: 2, useCORS: true });
        generatedImage.value = canvas.toDataURL('image/png');
        downloadReady.value = true;
        launchResult.value = null;
      } catch (e) {
        console.error(e);
        alert('Failed to generate card');
      } finally {
        isGenerating.value = false;
      }
    };

    const downloadCard = () => {
      if (!generatedImage.value) return;
      const a = document.createElement('a');
      a.download = `pumpbattle-card-${Date.now()}.png`;
      a.href = generatedImage.value;
      a.click();
    };

    // Launch token
    const ticker = computed(() => tickerInput.value.trim().toUpperCase());
    const canLaunch = computed(() => {
      return ticker.value && ticker.value.length >= 3 && ticker.value.length <= 5 && /^[A-Z0-9]+$/.test(ticker.value)
        && imagePreview.value && cardName.value && !launchStatus.value;
    });

    const API_BASE = import.meta.env.VITE_API_URL || 'https://backend-pearl-omega-33.vercel.app';

    const launchToken = async () => {
      if (!canLaunch.value) return;
      launchStatus.value = 'Preparing...';
      try {
        // Prepare form data
        const formData = new FormData();
        formData.append('ticker', ticker.value);
        formData.append('name', cardName.value);
        formData.append('description', cardDescription.value);
        // Convert dataURL to blob
        const imgRes = await fetch(generatedImage.value);
        const imgBlob = await imgRes.blob();
        formData.append('image', imgBlob, `${ticker.value}.png`);
        const resp = await fetch(`${API_BASE}/api/launch`, { method: 'POST', body: formData });
        const data = await resp.json();
        if (data.success) {
          launchResult.value = data;
          launchStatus.value = '';
          // Refresh leaderboard
          fetchGameStatus();
        } else {
          throw new Error(data.error || 'Launch failed');
        }
      } catch (e) {
        alert('Launch error: ' + e.message);
        launchStatus.value = '';
      }
    };

    // Leaderboard polling
    let pollInterval;
    const fetchGameStatus = async () => {
      try {
        const API_BASE = import.meta.env.VITE_API_URL || 'https://backend-pearl-omega-33.vercel.app';
        const [statusRes, leaderRes] = await Promise.all([
          fetch(`${API_BASE}/api/status`),
          fetch(`${API_BASE}/api/leaderboard`)
        ]);
        const status = await statusRes.json();
        const lead = await leaderRes.json();
        currentPot.value = status.potAmount;
        timeLeft.value = status.timeLeft;
        leaderboard.value = lead.tokens;
      } catch (e) {
        console.error('Failed to fetch game data', e);
      }
    };

    onMounted(() => {
      fetchGameStatus();
      pollInterval = setInterval(fetchGameStatus, 10000);
    });

    onUnmounted(() => {
      if (pollInterval) clearInterval(pollInterval);
    });

    // Tighten spacing: move type-badge into header-bar container and ensure badges mirror

    // Helpers
    const getRarityShort = (r) => {
      const map = { common:'C', uncommon:'UC', rare:'R', epic:'E', legendary:'L', normie:'N', degen:'D', chad:'CH', based:'B', king:'K', queen:'Q', gem:'G', rigged:'RG', alpha:'α', beta:'β', gamma:'γ', moon:'🌙', doonly:'DO', dank:'Dank', 'mega-dank':'Mega', 'ultra-dank':'Ultra', 'black swan':'BS', infinite:'∞', omnichad:'OC' };
      return map[r] || r.charAt(0).toUpperCase();
    };
    const getRarityFull = (r) => r.split('-').map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
    const getEditionNumber = () => `#${String(Math.floor(Math.random()*10000)).padStart(4,'0')}`;
    const hexToRgb = (hex) => { const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); return m ? `${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)}` : '255,255,255'; };
    const cardStyle = computed(() => {
      const color = rarityColors[cardRarity.value] || '#fff';
      return { '--glow-color': hexToRgb(color), borderColor: color };
    });
    const glowColor = computed(() => hexToRgb(rarityColors[cardRarity.value] || '#fff'));
    const formatNumber = (num) => num ? num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '0.00';
    const formatTime = (ms) => {
      if (ms <= 0) return '00:00:00';
      const hrs = Math.floor(ms / 3600000);
      const mins = Math.floor((ms % 3600000) / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      return `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
    };

    // Reset type to something matching the card? Not needed.

    return {
      imagePreview, cardName, cardDescription, cardRarity, cardAttack, cardDefense, cardType,
      cardAbility, cardResistance, isGenerating, downloadReady, generatedImage, rarityColors,
      handleImageUpload, generateCard, downloadCard,
      getRarityShort, getRarityFull, getEditionNumber, cardStyle, glowColor,
      // game
      leaderboard, currentPot, timeLeft, loading, launchStatus, launchResult, tickerInput,
      canLaunch, launchToken, formatNumber, formatTime
    };
  }
}).mount('#app');
