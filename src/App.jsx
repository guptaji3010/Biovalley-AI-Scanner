import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, RefreshCw, Sparkles, ShieldCheck, CheckCircle2, Activity, ShieldPlus } from 'lucide-react';
import './App.css';

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY;

function App() {
  const [image, setImage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [catalogText, setCatalogText] = useState("Loading latest catalog...");

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        const res = await fetch('https://bio-valley.com/products.json?limit=250');
        const data = await res.json();
        const products = data.products || [];

        let catalogString = "";
        products.forEach(p => {
          const title = p.title;
          const url = `https://bio-valley.com/products/${p.handle}`;
          const price = p.variants?.[0]?.price ? `₹${p.variants[0].price}` : 'Price unlisted';
          const type = p.product_type || 'Skincare/Haircare';

          catalogString += `- ${title} (${type}) | ${url} | ${price}\n`;
        });

        if (catalogString) {
          setCatalogText(catalogString.trim());
        }
      } catch (err) {
        console.error("Failed to fetch dynamic catalog:", err);
        // Fallback
        setCatalogText(`- Winter Glow Gift Box (Deep hydration pack) | https://bio-valley.com/products/winter-glow-gift-box | ₹1,299\n- Sugar Strawberry Face Wash (Gentle exfoliation) | https://bio-valley.com/products/sugar-strawberry-facewash | ₹375\n- Calendula Mimosa Body Lotion (Soothing for dry skin) | https://bio-valley.com/products/calendula-mimosa-body-lotion | ₹399\n- Kiwi Refresh Body Lotion (Oily/combination skin hydration) | https://bio-valley.com/products/kiwi-refresh-body-lotion | ₹249\n- Argan Oil Shampoo (Nourishes & strengthens hair) | https://bio-valley.com/products/argan-oil-shampoo | ₹891\n- Cedarwood Shampoo (Purifies and balances scalp) | https://bio-valley.com/products/cedarwood-shampoo | ₹891\n- Dead Sea Shampoo (Mineral-rich for flaky scalp) | https://bio-valley.com/products/dead-sea-shampoo | ₹843\n- Keratin Shampoo (Repairs & smoothens damage) | https://bio-valley.com/products/keratin-shampoo | ₹843`);
      }
    };

    fetchCatalog();
  }, []);

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      if (file.size > 4 * 1024 * 1024) { // 4MB limit
        setError("File size too large. Please upload an image under 4MB.");
        return;
      }
      setError(null);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImage(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    try {
      setShowCamera(true);
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError("Camera access denied or unavailable on this device.");
      setShowCamera(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Scale down the image to max 800px on the longest side to prevent payload size issues
      const MAX_SIZE = 800;
      let width = video.videoWidth;
      let height = video.videoHeight;

      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, width, height);

      // Use higher compression for safety
      const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
      setImage(dataUrl);
      stopCamera();
    }
  };

  const handleAnalyze = async () => {
    if (!image) return;
    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          temperature: 0.1,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are an expert dermatologist and hair care specialist for an Indian cosmetics brand named Bio Valley. Analyze this image of a person's skin or scalp. \n\nProvide your response in TWO clear sections:\n\n1. ANALYSIS: A brief, empathetic, 2-3 sentence analysis of what you observe (e.g., dryness, oiliness, dandruff, dullness).\n2. RECOMMENDATIONS: Based on your analysis, recommend EXACTLY 3 products from this Bio Valley catalog that form a complete routine.\n\nCRITICAL: You MUST format your recommendations exactly like this, with a pipe symbol '|' separating the fields:\nPRODUCT: [Name] - [Short Description] | [URL] | [Price]\n\nCatalog:\n${catalogText}`
                },
                {
                  type: "image_url",
                  image_url: {
                    url: image
                  }
                }
              ]
            }
          ]
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        const apiErrorMsg = errData?.error?.message || response.statusText;
        throw new Error(`API Error: ${response.status} - ${apiErrorMsg}`);
      }

      const data = await response.json();
      const rawText = data.choices[0].message.content;
      console.log("RAW AI RESPONSE:\\n", rawText);

      // --- ROBUST PARSER ---
      let analysisText = "We couldn't generate a specific analysis.";
      const recs = [];

      // 1. Clean markdown artifacts
      const cleanText = rawText.replace(/\*\*/g, '').replace(/__/g, '');

      // 2. Extract Analysis
      let analysisMatch = cleanText.match(/ANALYSIS:?(.*?)(?:RECOMMENDATION[S]?|Given the|Here are|$)/i);

      if (analysisMatch && analysisMatch[1]) {
        let extracted = analysisMatch[1].replace(/^[\s#:-]+/, '').trim();
        // Aggressive fallback to snip anything masquerading as recommendations transition
        extracted = extracted.split(/##?\s*RECOMMENDATION/i)[0].trim();

        if (extracted.length > 10) {
          analysisText = extracted;
        }
      } else {
        const splitText = cleanText.split(/(?:\d+\.|PRODUCT:|##? RECOMMENDATION)/i);
        if (splitText.length > 0) {
          analysisText = splitText[0].replace(/ANALYSIS:?/i, '').replace(/^[\s#:-]+/, '').trim();
        }
      }

      // 3. Extract Products (using | separator)
      const parts = cleanText.split('|');
      if (parts.length >= 3) {
        for (let i = 1; i < parts.length; i += 2) {
          const urlPart = parts[i]?.trim();
          if (!urlPart || !urlPart.startsWith('http')) continue;

          // Extract Name and Description from the preceding segment
          let nameDescStr = parts[i - 1];
          // Remove leftover price strings from the previous item so they don't interfere
          nameDescStr = nameDescStr.replace(/(?:₹|Rs\.?)\s*[\d,]+(?:\.\d+)?/gi, '');

          // Split by list numbers or "PRODUCT:" only when separated by space or start of string
          const nameDescTokens = nameDescStr.split(/(?:^|\s+)(?:\d+\.\s+|PRODUCT:\s*|- \*\*)/i);
          let cleanNameDesc = nameDescTokens[nameDescTokens.length - 1].trim();
          // Strip leading bullet points/dashes
          cleanNameDesc = cleanNameDesc.replace(/^[\s\-\*:]+/, '').trim();

          let name = "Bio Valley Product";
          let desc = "";

          if (cleanNameDesc.includes(':')) {
            const splitIdx = cleanNameDesc.indexOf(':');
            name = cleanNameDesc.substring(0, splitIdx).trim();
            desc = cleanNameDesc.substring(splitIdx + 1).trim();
          } else if (cleanNameDesc.includes('-')) {
            const splitIdx = cleanNameDesc.indexOf('-');
            name = cleanNameDesc.substring(0, splitIdx).trim();
            desc = cleanNameDesc.substring(splitIdx + 1).trim();
          } else {
            name = cleanNameDesc;
          }

          // Extract Price from the succeeding segment
          let priceStr = parts[i + 1] || "";
          const priceMatch = priceStr.match(/(?:₹|Rs\.?)\s*[\d,]+(?:\.\d+)?/i);
          let rawPriceStr = priceStr.replace(/^[\s\-\*:]+/, '').trim();
          let finalPrice = priceMatch ? priceMatch[0] : rawPriceStr.split(/\s+/)[0];

          recs.push({
            name: name.replace(/#/g, '').trim() || "Product",
            description: desc.replace(/#/g, '').trim(),
            url: urlPart,
            price: finalPrice
          });
        }
      }

      // Fallback if parsing fails totally but we have text
      if (recs.length === 0 && rawText && !cleanText.includes('|')) {
        analysisText = rawText;
      }
      // --- END PARSER ---

      setResult({
        analysis: analysisText,
        recommendations: recs.length > 0 ? recs : [
          {
            name: "Bio Valley Original Catalog",
            description: "View our natural skin and body care range",
            url: "https://bio-valley.com/",
            price: ""
          }
        ]
      });

    } catch (err) {
      console.error("Groq API Error:", err);
      // Display the actual error message to the UI
      setError(`${err.message}. If this persists, the API key may be invalid or quota exceeded.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetScanner = () => {
    setImage(null);
    setResult(null);
    setIsProcessing(false);
    setError(null);
  };

  return (
    <div className="min-h-screen pt-0 pb-4 px-2 md:px-4 flex flex-col items-center">
      {/* Header */}
      <header className="w-full max-w-5xl flex justify-center items-center m-0 border-b border-gray-200/60 pb-3">
        <div className="flex flex-col items-center gap-1 md:gap-2">
          {/* Using excessive negative margin to eat up the transparent space inside the user's logo */}
          <img src="/biovalley-logo-stacked.png" alt="Bio Valley Logo" className="h-28 md:h-36 -mt-10 -mb-6 object-contain drop-shadow-sm filter contrast-125 hover:scale-105 transition-transform duration-500" />
          <div className="flex items-center gap-3 md:gap-4 mt-0 text-[10px] md:text-xs font-semibold text-gray-500 uppercase tracking-widest bg-white/50 px-3 md:px-5 py-1 md:py-1.5 rounded-full border border-gray-200 shadow-sm relative z-10">
            <span className="flex items-center gap-1.5"><ShieldPlus className="w-3.5 h-3.5 text-[var(--primary)]" /> Dermatologist backed</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
            <span className="flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-[var(--accent)]" /> AI Analysis</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="w-full max-w-5xl flex flex-col md:flex-row gap-6 md:gap-8">

        {/* Left Col: Scanner Area */}
        <div className="flex-1">
          <div className="bg-white/95 backdrop-blur-xl rounded-[2rem] p-6 md:p-8 h-full flex flex-col justify-center items-center relative overflow-hidden transition-all duration-500 shadow-xl md:shadow-2xl border border-white">

            {showCamera ? (
              <div className="w-full h-full flex flex-col items-center justify-center space-y-6">
                <div className="text-center">
                  <span className="bg-[var(--primary)] text-white px-5 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase mb-3 inline-block shadow-md">Step 1 of 2</span>
                  <h2 className="text-3xl font-serif text-[var(--primary)] mt-2">Position your Face or Scalp</h2>
                </div>
                <div className="relative w-full max-w-md h-72 md:h-80 rounded-3xl overflow-hidden bg-black flex items-center justify-center shadow-inner border-4 border-gray-100 ring-4 ring-white">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  ></video>
                  <canvas ref={canvasRef} className="hidden"></canvas>
                  <div className="absolute inset-0 border-2 border-white/20 rounded-3xl pointer-events-none m-4"></div>
                </div>
                <div className="flex gap-4 w-full max-w-md">
                  <button
                    onClick={stopCamera}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 px-6 py-4 rounded-2xl font-semibold transition shadow-sm border border-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={capturePhoto}
                    className="flex-[2] bg-[var(--primary)] hover:bg-[var(--primary-light)] text-white px-6 py-4 rounded-2xl font-semibold transition flex items-center justify-center gap-2 shadow-lg shadow-[var(--primary)]/30 hover:-translate-y-0.5"
                  >
                    <Camera className="h-5 w-5" />
                    Capture Photo
                  </button>
                </div>
              </div>
            ) : !image ? (
              <div className="text-center space-y-4 md:space-y-6 max-w-lg mx-auto py-2 md:py-4">
                <h2 className="text-3xl md:text-4xl font-serif text-gray-900 tracking-tight leading-tight">
                  Discover your <span className="text-[var(--primary)]">skin instantly</span>
                </h2>

                <p className="text-gray-500 leading-relaxed font-light text-sm md:text-base px-2">
                  Upload a clear photo for an instant AI skin analysis and personalized Bio Valley product recommendations.
                </p>

                {error && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs md:text-sm mb-2 border border-red-200 font-medium text-left flex items-start gap-2">
                    <span className="bg-red-100 p-0.5 px-1.5 rounded-full shrink-0">!</span>
                    {error}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 md:gap-4 justify-center mt-6 md:mt-8 w-full">
                  <button
                    onClick={startCamera}
                    className="flex-1 bg-white hover:bg-gray-50 text-[var(--primary)] border-[1.5px] border-[var(--primary)]/20 hover:border-[var(--primary)] px-4 py-3 md:px-8 md:py-4 rounded-xl md:rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 shadow-sm text-sm md:text-base w-full"
                  >
                    <Camera className="h-4 w-4 md:h-5 md:w-5" />
                    Use Camera
                  </button>
                  <label className="flex-1 bg-[var(--primary)] hover:bg-[#152e17] text-white px-4 py-3 md:px-8 md:py-4 rounded-xl md:rounded-2xl font-semibold cursor-pointer transition-all flex items-center justify-center gap-2 shadow-md shadow-[var(--primary)]/20 hover:-translate-y-0.5 text-sm md:text-base w-full">
                    <Upload className="h-4 w-4 md:h-5 md:w-5" />
                    Upload File
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      onClick={(e) => { e.target.value = null }}
                    />
                  </label>
                </div>

                <p className="text-[10px] md:text-xs text-gray-400 mt-4 md:mt-6 pt-3 md:pt-4 border-t border-gray-100 flex items-center justify-center gap-1">
                  <ShieldCheck className="w-3 h-3 md:w-3.5 h-3.5" /> Photos processed securely, never stored.
                </p>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col justify-center items-center py-2">
                <div className="text-center mb-4 md:mb-6">
                  <span className="bg-[var(--primary)] text-white px-4 py-1 rounded-full text-[10px] md:text-xs font-bold tracking-widest uppercase inline-block shadow-md">Step 2 of 2</span>
                  <h2 className="text-2xl md:text-3xl font-serif text-[var(--primary)] mt-2 md:mt-3">Analyzing your conditions</h2>
                </div>

                <div className="relative w-full max-w-md h-56 md:h-72 rounded-[1.5rem] overflow-hidden mb-6 md:mb-8 bg-gray-50 shadow-inner border-[4px] border-white ring-1 ring-gray-100">
                  <img src={image} alt="Uploaded for analysis" className="w-full h-full object-cover" />

                  {isProcessing && (
                    <>
                      <div className="absolute inset-0 bg-[var(--primary)]/20 backdrop-blur-[2px] z-10 transition-all"></div>
                      <div className="absolute inset-x-0 h-1 bg-[var(--accent)] shadow-[0_0_20px_rgba(207,168,97,1)] z-20 animate-scan-line"></div>
                      <div className="absolute inset-0 flex flex-col items-center justify-center z-30">
                        <div className="bg-white/95 backdrop-blur-md shadow-[0_10px_40px_rgba(0,0,0,0.2)] text-[var(--primary)] px-5 md:px-8 py-3 md:py-4 rounded-full font-semibold flex items-center gap-2 md:gap-3 border border-[var(--primary)]/10">
                          <Activity className="h-5 w-5 md:h-6 md:w-6 text-[var(--accent)] animate-pulse" />
                          <span className="text-xs md:text-sm tracking-widest uppercase font-bold">Scanning Biometrics...</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {error && (
                  <div className="bg-red-50 text-red-700 p-3 rounded-lg text-xs md:text-sm mb-4 border border-red-200 text-center max-w-md font-medium">
                    {error}
                  </div>
                )}

                <div className="flex gap-4 justify-center w-full max-w-md">
                  {!isProcessing && !result && (
                    <button
                      onClick={handleAnalyze}
                      className="flex-1 bg-[var(--primary)] hover:bg-[#152e17] text-white px-8 py-4 rounded-2xl font-semibold text-lg transition-all flex items-center justify-center gap-3 shadow-lg shadow-[var(--primary)]/30 hover:-translate-y-1"
                    >
                      <Sparkles className="h-6 w-6" />
                      Get AI Diagnosis
                    </button>
                  )}

                  {!isProcessing && (
                    <button
                      onClick={resetScanner}
                      className="bg-gray-50 hover:bg-gray-100 text-gray-700 px-6 py-4 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 border border-gray-200 shadow-sm"
                    >
                      <RefreshCw className="h-5 w-5" />
                      Retake
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Results */}
        <div className="w-full md:w-[45%] flex flex-col gap-4 tracking-tight">
          <div className="bg-white/95 backdrop-blur-xl rounded-[2rem] p-6 md:p-8 h-full shadow-2xl border border-white flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-[var(--primary)] via-[var(--accent)] to-[var(--primary)]"></div>

            <h3 className="text-2xl md:text-3xl font-serif mb-6 flex items-center gap-3 text-[var(--primary)] border-b border-gray-100 pb-4">
              <ShieldCheck className="text-[var(--accent)] h-6 w-6 md:h-8 md:w-8" />
              Your Diagnosis
            </h3>

            {result ? (
              <div className="space-y-6 flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="bg-gradient-to-br from-[var(--secondary)]/40 to-white p-4 md:p-6 rounded-2xl text-sm md:text-base text-[var(--primary)] leading-relaxed border border-[var(--secondary)]/80 shadow-sm relative">
                  <div className="absolute -top-3 -left-2 text-4xl text-[var(--accent)] opacity-40">"</div>
                  <p className="relative z-10 font-medium italic pl-4">{result.analysis}</p>
                </div>

                <div className="pt-2 flex-1 flex flex-col">
                  <h4 className="font-bold text-gray-900 mb-6 text-sm uppercase tracking-widest flex items-center gap-4">
                    <span className="h-[2px] flex-1 bg-gradient-to-r from-transparent to-gray-200"></span>
                    <span className="bg-[var(--accent)]/10 text-[var(--primary)] px-4 py-1.5 rounded-full">Recommended Products</span>
                    <span className="h-[2px] flex-1 bg-gradient-to-l from-transparent to-gray-200"></span>
                  </h4>
                  <div className="space-y-4 flex-1">
                    {result.recommendations.map((prod, idx) => (
                      <a key={idx} href={prod.url} target="_blank" rel="noreferrer" className="flex items-center gap-4 bg-white p-4 rounded-2xl shadow-sm hover:shadow-xl transition-all border border-gray-100 hover:border-[var(--accent)] group relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-1.5 h-full bg-gradient-to-b from-[var(--primary)] to-[var(--accent)] transform -translate-x-full group-hover:translate-x-0 transition-transform"></div>

                        <div className="w-12 h-12 rounded-full bg-[var(--secondary)]/30 flex items-center justify-center shrink-0 border border-[var(--secondary)] text-[var(--primary)] font-serif font-bold text-xl group-hover:bg-[var(--primary)] group-hover:text-white transition-colors">
                          {idx + 1}
                        </div>

                        <div className="flex-1 min-w-0 pr-2">
                          <div className="font-serif text-xl text-[var(--primary)] group-hover:text-[var(--accent)] transition-colors truncate">{prod.name}</div>
                          {prod.description && <div className="text-sm text-gray-500 mt-1 line-clamp-1 font-light">{prod.description}</div>}
                        </div>

                        {prod.price && (
                          <div className="shrink-0 text-right">
                            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Price</div>
                            <div className="text-lg font-bold text-[var(--primary)]">{prod.price}</div>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-400 flex flex-col items-center justify-center h-full gap-6 p-4">
                <div className="bg-gradient-to-br from-gray-50 to-[var(--secondary)]/50 p-8 rounded-full border border-gray-100 shadow-inner relative">
                  <Sparkles className="h-12 w-12 text-[var(--accent)]/60" />
                  <div className="absolute inset-0 bg-[var(--primary)]/5 rounded-full animate-ping opacity-20"></div>
                </div>
                <p className="text-base font-light max-w-[240px] leading-relaxed text-gray-500">Your tailored Bio Valley prescription will appear here.</p>
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

export default App;
