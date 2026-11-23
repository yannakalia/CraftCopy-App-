import React, { useState } from 'react';
import {
  Store,
  User,
  Briefcase,
  ArrowRight,
  Check,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react';
import { ArtisanProfile } from '../types';

interface SellerInfoFormProps {
  profile: ArtisanProfile;
  onSaveProfile: (updatedProfile: ArtisanProfile) => void;
  onContinue: (updatedProfile: ArtisanProfile) => void;
  onSkip?: () => void;
  onOpenPrivacyNotice?: () => void;
}

const BUSINESS_TYPE_SUGGESTIONS = [
  'Handmade Crochet & Bags',
  'Artisan Leather Goods',
  'Ceramics & Pottery',
  'Handmade Jewelry',
  'Woodcraft & Home Decor',
  'Artisan Bakery & Bakes',
  'Hand-poured Candles & Soaps',
  'Woven Apparel & Textiles',
];

export const SellerInfoForm: React.FC<SellerInfoFormProps> = ({
  profile,
  onSaveProfile,
  onContinue,
  onSkip,
  onOpenPrivacyNotice,
}) => {
  const [formData, setFormData] = useState<ArtisanProfile>({
    ...profile,
    makerName: profile.makerName || '',
    studioName: profile.studioName || '',
    businessType: profile.businessType || profile.craftSpecialty || '',
    craftSpecialty: profile.craftSpecialty || profile.businessType || '',
    bio: profile.bio || '',
  });

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [saveSuccess, setSaveSuccess] = useState(false);

  React.useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      ...profile,
      makerName: profile.makerName || '',
      studioName: profile.studioName || '',
      businessType: profile.businessType || profile.craftSpecialty || '',
      craftSpecialty: profile.craftSpecialty || profile.businessType || '',
      bio: profile.bio || '',
    }));
  }, [profile]);

  const handleChange = (field: keyof ArtisanProfile, value: any) => {
    const updated: ArtisanProfile = {
      ...formData,
      [field]: value,
      ...(field === 'businessType' ? { craftSpecialty: value } : {}),
    };
    setFormData(updated);
    onSaveProfile(updated);

    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};
    if (!formData.studioName || !formData.studioName.trim()) {
      errs.studioName = 'Business name is required.';
    }
    if (!formData.makerName || !formData.makerName.trim()) {
      errs.makerName = 'Owner name is required.';
    }
    if (!formData.businessType || !formData.businessType.trim()) {
      errs.businessType = 'Business type is required.';
    }
    if (!formData.bio || !formData.bio.trim()) {
      errs.bio = 'Short business description is required.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSaveProfile(formData);
      onContinue(formData);
    }
  };

  const handleManualSave = () => {
    if (validate()) {
      onSaveProfile(formData);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl p-6 sm:p-7 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-artisan text-[#423023]">
            Your Business Profile
          </h1>
          <p className="text-xs sm:text-sm text-[#735F4C] mt-1 max-w-xl">
            Enter your essential business details once. CraftCopy saves your profile so every poster and caption reflects your brand.
          </p>
        </div>

        <button
          type="button"
          onClick={handleManualSave}
          className="px-4 py-2 rounded-xl bg-white border border-[#4E654E]/40 text-[#2F442F] hover:bg-[#E7EFE6] text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs shrink-0"
        >
          {saveSuccess ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-700">Saved for Reuse!</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#4E654E]" />
              <span>Save Business Profile</span>
            </>
          )}
        </button>
      </div>

      {/* Validation Errors */}
      {Object.keys(errors).length > 0 && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Please complete these essential fields:</p>
            <ul className="list-disc list-inside mt-1 space-y-0.5 text-red-700">
              {Object.values(errors).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Essential Seller Information Form */}
      <form onSubmit={handleContinue} className="space-y-6">
        <div className="bg-[#FAF7F2] border border-[#E8DFD1] rounded-3xl p-5 sm:p-7 shadow-xs space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Business Name */}
            <div>
              <label htmlFor="seller-business-name" className="block text-xs font-bold text-[#423023] mb-1.5">
                Business Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Store className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C7A6B]" />
                <input
                  type="text"
                  id="seller-business-name"
                  placeholder="e.g., Tala Artisan Workshop"
                  value={formData.studioName}
                  onChange={(e) => handleChange('studioName', e.target.value)}
                  className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl border text-xs sm:text-sm bg-white text-[#423023] focus:outline-none focus:ring-2 ${
                    errors.studioName
                      ? 'border-red-400 focus:ring-red-400'
                      : 'border-[#D5C7B6] focus:ring-[#4E654E]'
                  }`}
                />
              </div>
              {errors.studioName && (
                <p className="text-[11px] text-red-600 mt-1">{errors.studioName}</p>
              )}
            </div>

            {/* Owner Name */}
            <div>
              <label htmlFor="seller-owner-name" className="block text-xs font-bold text-[#423023] mb-1.5">
                Owner Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C7A6B]" />
                <input
                  type="text"
                  id="seller-owner-name"
                  placeholder="e.g., Elena Santos"
                  value={formData.makerName}
                  onChange={(e) => handleChange('makerName', e.target.value)}
                  className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl border text-xs sm:text-sm bg-white text-[#423023] focus:outline-none focus:ring-2 ${
                    errors.makerName
                      ? 'border-red-400 focus:ring-red-400'
                      : 'border-[#D5C7B6] focus:ring-[#4E654E]'
                  }`}
                />
              </div>
              {errors.makerName && (
                <p className="text-[11px] text-red-600 mt-1">{errors.makerName}</p>
              )}
            </div>
          </div>

          {/* Business Type */}
          <div>
            <label htmlFor="seller-business-type" className="block text-xs font-bold text-[#423023] mb-1.5">
              Business Type <span className="text-red-500">*</span>
            </label>
            <div className="relative mb-2">
              <Briefcase className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8C7A6B]" />
              <input
                type="text"
                id="seller-business-type"
                placeholder="e.g., Handmade Crochet & Bags, Ceramics, Artisan Bakery"
                value={formData.businessType}
                onChange={(e) => handleChange('businessType', e.target.value)}
                className={`w-full pl-9 pr-3.5 py-2.5 rounded-xl border text-xs sm:text-sm bg-white text-[#423023] focus:outline-none focus:ring-2 ${
                  errors.businessType
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-[#D5C7B6] focus:ring-[#4E654E]'
                }`}
              />
            </div>
            {errors.businessType && (
              <p className="text-[11px] text-red-600 mb-2">{errors.businessType}</p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {BUSINESS_TYPE_SUGGESTIONS.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleChange('businessType', type)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border transition-all ${
                    formData.businessType === type
                      ? 'bg-[#4E654E] text-white border-[#4E654E]'
                      : 'bg-white text-[#553E2E] border-[#D8CCBC] hover:bg-[#EFE7DA]'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Short Business Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="seller-business-description" className="text-xs font-bold text-[#423023]">
                Short Business Description <span className="text-red-500">*</span>
              </label>
              <span className="text-[11px] text-[#8C7A6B]">
                {formData.bio.length} characters
              </span>
            </div>
            <textarea
              id="seller-business-description"
              rows={3}
              placeholder="Briefly describe what you make, your style, and what makes your craft special..."
              value={formData.bio}
              onChange={(e) => handleChange('bio', e.target.value)}
              className={`w-full p-3 rounded-xl border text-xs sm:text-sm bg-white text-[#423023] focus:outline-none focus:ring-2 ${
                errors.bio
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-[#D5C7B6] focus:ring-[#4E654E]'
              }`}
            />
            {errors.bio && (
              <p className="text-[11px] text-red-600 mt-1">{errors.bio}</p>
            )}
          </div>

          <div className="p-3.5 rounded-2xl bg-[#F4EFE6] border border-[#E3D5C1] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#5C4A3C]">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-[#4E654E] shrink-0 mt-0.5" />
              <span>
                Your Business Profile stays saved locally in your browser without needing an account. Only Owner Name, Business Name, and product or poster details you choose to save are stored in the database.
              </span>
            </div>
            {onOpenPrivacyNotice && (
              <button
                type="button"
                onClick={onOpenPrivacyNotice}
                className="text-[#4E654E] font-bold hover:underline shrink-0 text-left sm:text-right"
              >
                Privacy Notice
              </button>
            )}
          </div>
        </div>

        {/* Continue / Back Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3">
          {onSkip ? (
            <button
              type="button"
              id="btn-skip-seller-info"
              onClick={onSkip}
              className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-white border border-[#D5C7B6] text-[#553E2E] hover:bg-[#EFE7DA] font-semibold text-xs sm:text-sm transition-all"
            >
              Back to Product Form
            </button>
          ) : (
            <div />
          )}
          <button
            type="submit"
            id="btn-continue-product-info"
            className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-[#4E654E] hover:bg-[#3E523E] text-[#FAF7F2] font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-md hover:shadow-lg transition-all active:scale-[0.99]"
          >
            <span>Continue to Product Information</span>
            <ArrowRight className="w-5 h-5 text-[#E7EFE6]" />
          </button>
        </div>
      </form>
    </div>
  );
};
