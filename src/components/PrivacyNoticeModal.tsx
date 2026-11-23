import React, { useState } from 'react';
import {
  ShieldCheck,
  X,
  Lock,
  Image as ImageIcon,
  Database,
  Trash2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface PrivacyNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClearLocalData?: () => void;
}

export const PrivacyNoticeModal: React.FC<PrivacyNoticeModalProps> = ({
  isOpen,
  onClose,
  onClearLocalData,
}) => {
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearedFeedback, setClearedFeedback] = useState(false);

  if (!isOpen) return null;

  const handleConfirmClear = () => {
    if (onClearLocalData) {
      onClearLocalData();
    }
    setConfirmClear(false);
    setClearedFeedback(true);
    setTimeout(() => setClearedFeedback(false), 4000);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-notice-title"
    >
      <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl max-w-xl w-full p-6 sm:p-7 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#4E654E] text-white flex items-center justify-center shadow-xs shrink-0">
              <ShieldCheck className="w-6 h-6 text-[#E7EFE6]" />
            </div>
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#8B6544]">
                CraftCopy Privacy &amp; Data Protection
              </span>
              <h3
                id="privacy-notice-title"
                className="text-lg sm:text-xl font-bold font-artisan text-[#423023]"
              >
                Simple Privacy Notice
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy notice"
            className="p-1.5 rounded-lg text-[#887463] hover:bg-[#EFE7DA] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Plain-Language Overview */}
        <p className="text-xs sm:text-sm text-[#4E3928] leading-relaxed bg-[#F5ECE0] border border-[#E3D4C0] rounded-2xl p-4">
          CraftCopy works without requiring an account or sign-in. We keep data collection minimal and protect your personal details, uploaded product photos, and generated content across every step.
        </p>

        {/* Key Protections */}
        <div className="space-y-3">
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-[#D5C7B6]">
            <div className="w-8 h-8 rounded-lg bg-[#E7EFE6] text-[#4E654E] flex items-center justify-center shrink-0 mt-0.5">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#423023]">
                Personal &amp; Business Information
              </h4>
              <p className="text-xs text-[#715E4E] mt-0.5 leading-relaxed">
                Your Business Profile stays saved locally in your browser. Only the Owner Name, Business Name, and product details you choose to save are stored in the database alongside your saved products or posters.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-[#D5C7B6]">
            <div className="w-8 h-8 rounded-lg bg-[#FFF2DA] text-[#A6781B] flex items-center justify-center shrink-0 mt-0.5">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#423023]">
                Product Photos &amp; Metadata Removal
              </h4>
              <p className="text-xs text-[#715E4E] mt-0.5 leading-relaxed">
                Uploaded photos are validated for image file integrity, and hidden EXIF/camera/GPS location metadata is automatically stripped before storage or poster rendering. Photos are used only to create your promotional posters and copy.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white border border-[#D5C7B6]">
            <div className="w-8 h-8 rounded-lg bg-[#EAE2D3] text-[#654E3C] flex items-center justify-center shrink-0 mt-0.5">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-[#423023]">
                Protected API &amp; Database Connections
              </h4>
              <p className="text-xs text-[#715E4E] mt-0.5 leading-relaxed">
                All AI generation and Supabase database/storage requests are routed through CraftCopy&apos;s server API with input validation and rate limiting—API keys and database credentials are never sent to your browser.
              </p>
            </div>
          </div>
        </div>

        {/* Local Data Control */}
        {onClearLocalData && (
          <div className="p-4 rounded-2xl bg-white border border-[#D5C7B6] space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-[#423023]">
                  Manage Local Browser Data
                </h4>
                <p className="text-[11px] text-[#715E4E]">
                  Clear your Business Profile and local drafts stored on this device. Saved Supabase records remain untouched.
                </p>
              </div>
              {!confirmClear && (
                <button
                  type="button"
                  id="btn-clear-local-data"
                  onClick={() => setConfirmClear(true)}
                  className="px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Local Data</span>
                </button>
              )}
            </div>

            {confirmClear && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-amber-900 font-medium flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  Clear Business Profile &amp; drafts from this browser?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="px-2.5 py-1 rounded-lg bg-white border border-[#D5C7B6] text-[#553E2E] font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    id="btn-confirm-clear-local-data"
                    onClick={handleConfirmClear}
                    className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold"
                  >
                    Confirm Clear
                  </button>
                </div>
              </div>
            )}

            {clearedFeedback && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Local Business Profile and browser drafts cleared.</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="pt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[#4E654E] text-white text-xs font-bold hover:bg-[#3E523E] transition-all shadow-xs"
          >
            Close Privacy Notice
          </button>
        </div>
      </div>
    </div>
  );
};
