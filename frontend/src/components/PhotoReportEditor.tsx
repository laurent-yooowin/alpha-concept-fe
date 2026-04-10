import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

// Group photos by groupId
interface PhotoGroup {
    groupId: string;
    photos: any[];
    isDirectiveOnly: boolean;
    analysis: any;
    comment: string;
    directives: string;
}

function PhotoReportEditor({
    initialPhotos,
    downloadImages,
    isEditing,
    editedHeader = '',
    editedFooter = '',
    onPhotosChange,
    onHeaderChange,
    onFooterChange,
    onSave,
}: any) {
    const [photos, setPhotos] = useState(initialPhotos);
    const [base64Images, setBase64Images] = useState({});
    const [loading, setLoading] = useState(true);
    const [header, setHeader] = useState(editedHeader);
    const [footer, setFooter] = useState(editedFooter);

    // Block-based editing state (keyed by groupId)
    const [blockItems, setBlockItems] = useState<Record<string, string[]>>({});

    useEffect(() => { loadImages(); }, []);
    useEffect(() => { setHeader(editedHeader); }, [editedHeader]);
    useEffect(() => { setFooter(editedFooter); }, [editedFooter]);

    // Build photo groups
    const photoGroups = useMemo((): PhotoGroup[] => {
        const groups: Record<string, any[]> = {};
        (photos || []).forEach((photo: any) => {
            const gid = photo.groupId || photo.id;
            if (!groups[gid]) groups[gid] = [];
            groups[gid].push(photo);
        });
        return Object.entries(groups).map(([groupId, groupPhotos]) => {
            const first = groupPhotos[0];
            const toArr = (val: any) => { if (!val) return []; return Array.isArray(val) ? val : [val]; };
            return {
                groupId,
                photos: groupPhotos,
                isDirectiveOnly: first?.isDirectiveOnly || false,
                analysis: first?.analysis ? {
                    observation: toArr(first.analysis.observation),
                    recommendation: toArr(first.analysis.recommendation),
                    references: toArr(first.analysis.references),
                    riskLevel: first.analysis.riskLevel,
                    confidence: first.analysis.confidence,
                } : null,
                comment: first?.comment || '',
                directives: first?.userDirectives || '',
            };
        });
    }, [photos]);

    useEffect(() => {
        setPhotos(initialPhotos);
        // Initialize block items by group
        const items: Record<string, string[]> = {};
        const groups: Record<string, any[]> = {};
        (initialPhotos || []).forEach((photo: any) => {
            const gid = photo.groupId || photo.id;
            if (!groups[gid]) groups[gid] = [];
            groups[gid].push(photo);
        });
        Object.entries(groups).forEach(([groupId, groupPhotos]) => {
            const first = groupPhotos[0];
            const obs = first?.analysis?.observation || [];
            const rec = first?.analysis?.recommendation || [];
            const refs = first?.analysis?.references || [];
            const comment = first?.comment || '';
            items[`${groupId}-observation`] = Array.isArray(obs) ? [...obs] : [obs].filter(Boolean);
            items[`${groupId}-recommendation`] = Array.isArray(rec) ? [...rec] : [rec].filter(Boolean);
            items[`${groupId}-references`] = Array.isArray(refs) ? [...refs] : [refs].filter(Boolean);
            items[`${groupId}-comment`] = comment ? [comment] : [];
        });
        setBlockItems(items);
    }, [initialPhotos]);

    useEffect(() => { if (onPhotosChange) onPhotosChange(photos); }, [photos]);
    useEffect(() => { if (onHeaderChange) onHeaderChange(header); }, [header]);
    useEffect(() => { if (onFooterChange) onFooterChange(footer); }, [footer]);

    // Sync block items back to photos when editing
    useEffect(() => {
        if (!isEditing) return;
        const updatedPhotos = photos.map((photo: any) => {
            const gid = photo.groupId || photo.id;
            const obs = blockItems[`${gid}-observation`];
            const rec = blockItems[`${gid}-recommendation`];
            const refs = blockItems[`${gid}-references`];
            const comments = blockItems[`${gid}-comment`];
            if (obs || rec || refs || comments) {
                return {
                    ...photo,
                    analysis: photo.analysis ? {
                        ...photo.analysis,
                        observation: (obs || []).filter((s: string) => s.trim().length > 0),
                        recommendation: (rec || []).filter((s: string) => s.trim().length > 0),
                        references: (refs || []).filter((s: string) => s.trim().length > 0),
                    } : photo.analysis,
                    comment: (comments || []).join('\n').trim(),
                };
            }
            return photo;
        });
        const hasChanges = updatedPhotos.some((p: any, i: number) => {
            const orig = photos[i];
            return JSON.stringify(p.analysis) !== JSON.stringify(orig.analysis) || p.comment !== orig.comment;
        });
        if (hasChanges) setPhotos(updatedPhotos);
    }, [blockItems, isEditing]);

    const loadImages = async () => {
        setLoading(true);
        try {
            const imagesMap: Record<string, string> = {};
            await Promise.all((initialPhotos || []).map(async (photo: any) => {
                try {
                    if (!photo.s3Url) return;
                    const base64 = await downloadImages(photo.s3Url);
                    if (base64) {
                        imagesMap[photo.id] = base64.startsWith('data:image') ? base64 : `data:image/jpeg;base64,${base64}`;
                    }
                } catch (error) {
                    console.error(`Erreur chargement image ${photo.id}:`, error);
                }
            }));
            setBase64Images(imagesMap);
        } catch (error) {
            console.error('Erreur lors du chargement des images:', error);
        } finally {
            setLoading(false);
        }
    };

    const getRiskLevelLabel = (level: string) => {
        const levels: Record<string, string> = { 'eleve': 'HIGH', 'moyen': 'MEDIUM', 'faible': 'LOW' };
        return levels[level] || level?.toUpperCase?.() || '';
    };

    const getRiskLevelColor = (level: string) => {
        const colors: Record<string, string> = { 'eleve': '#dc3545', 'moyen': '#ffc107', 'faible': '#28a745' };
        return colors[level] || '#6c757d';
    };

    // Block editing helpers (keyed by groupId)
    const addBlockItem = (groupId: string, field: string) => {
        const key = `${groupId}-${field}`;
        setBlockItems(prev => ({ ...prev, [key]: [...(prev[key] || []), ''] }));
    };

    const updateBlockItem = (groupId: string, field: string, index: number, value: string) => {
        const key = `${groupId}-${field}`;
        setBlockItems(prev => ({
            ...prev,
            [key]: (prev[key] || []).map((v, i) => i === index ? value : v)
        }));
    };

    const removeBlockItem = (groupId: string, field: string, index: number) => {
        const key = `${groupId}-${field}`;
        setBlockItems(prev => ({
            ...prev,
            [key]: (prev[key] || []).filter((_, i) => i !== index)
        }));
    };

    const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>, groupId: string) => {
        const value = e.target.value;
        setPhotos((prevPhotos: any[]) =>
            prevPhotos.map((photo: any) => {
                if ((photo.groupId || photo.id) === groupId) {
                    return { ...photo, comment: value };
                }
                return photo;
            })
        );
    };

    if (loading) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', fontSize: '16px', color: '#555' }}>
                ⏳ Chargement des images...
            </div>
        );
    }

    const renderBlockField = (groupId: string, field: string, label: string, color: string, bgColor: string, borderColor: string, icon: string) => {
        const key = `${groupId}-${field}`;
        const items = blockItems[key] || [];

        return (
            <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <label style={{
                        fontWeight: '700', display: 'flex', fontSize: '15px', color,
                        alignItems: 'center', gap: '8px'
                    }}>
                        <span style={{ width: '4px', height: '20px', backgroundColor: color, borderRadius: '2px' }}></span>
                        {icon} {label}
                    </label>
                    {isEditing && (
                        <button
                            onClick={() => addBlockItem(groupId, field)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '4px',
                                fontSize: '12px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer',
                                padding: '4px 8px', borderRadius: '6px',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#eff6ff')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                            <Plus size={14} /> Ajouter
                        </button>
                    )}
                </div>
                {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {items.map((item, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                <span style={{ color, marginTop: '10px', fontSize: '14px' }}>•</span>
                                <textarea
                                    value={item}
                                    onChange={(e) => updateBlockItem(groupId, field, i, e.target.value)}
                                    rows={3}
                                    style={{
                                        flex: 1, padding: '8px 12px', fontSize: '13px',
                                        borderRadius: '8px', border: `1.5px solid ${borderColor}`,
                                        backgroundColor: bgColor, outline: 'none', resize: 'vertical',
                                        fontFamily: 'system-ui, sans-serif', lineHeight: '1.5',
                                        transition: 'border-color 0.2s',
                                    }}
                                    onFocus={(e) => { e.target.style.borderColor = color; e.target.style.boxShadow = `0 0 0 3px ${color}15`; }}
                                    onBlur={(e) => { e.target.style.borderColor = borderColor; e.target.style.boxShadow = 'none'; }}
                                />
                                <button
                                    onClick={() => removeBlockItem(groupId, field, i)}
                                    style={{
                                        padding: '6px', color: '#ef4444', background: 'none', border: 'none',
                                        cursor: 'pointer', marginTop: '4px', borderRadius: '6px',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#fef2f2')}
                                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))}
                        {items.length === 0 && (
                            <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', padding: '8px' }}>
                                Aucun élément — cliquez Ajouter
                            </p>
                        )}
                    </div>
                ) : (
                    items.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {items.filter(s => s.trim()).map((item, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                                    fontSize: '14px', color: '#475569', lineHeight: '1.6',
                                }}>
                                    <span style={{ color, marginTop: '2px' }}>•</span>
                                    <span>{item}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', padding: '8px' }}>Aucun élément</p>
                    )
                )}
            </div>
        );
    };

    const renderGroup = (group: PhotoGroup, index: number) => {
        const riskLevel = group.analysis?.riskLevel || 'faible';
        const nonDirectivePhotos = group.photos.filter((p: any) => !p.isDirectiveOnly && p.s3Url);

        return (
            <div key={group.groupId} style={{
                marginBottom: '50px',
                border: `3px solid ${getRiskLevelColor(riskLevel)}`,
                borderRadius: '16px', padding: '30px', backgroundColor: '#ffffff',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)', position: 'relative',
            }}>
                {/* Risk badge */}
                {group.analysis && (
                    <div style={{
                        position: 'absolute', top: '-15px', right: '30px',
                        backgroundColor: getRiskLevelColor(riskLevel),
                        color: 'white', padding: '8px 20px', borderRadius: '20px',
                        fontWeight: 'bold', fontSize: '13px', boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                    }}>
                        {getRiskLevelLabel(riskLevel)}
                    </div>
                )}

                <h3 style={{
                    marginBottom: '25px', fontSize: '22px', fontWeight: '700', color: '#2c3e50',
                    borderBottom: `3px solid ${getRiskLevelColor(riskLevel)}`, paddingBottom: '12px',
                }}>
                    {group.isDirectiveOnly ? `📝 Rapport ${index + 1} — Directives` : `📸 Rapport ${index + 1} — ${group.photos.length} photo(s)`}
                </h3>

                {/* Photos grid */}
                {!group.isDirectiveOnly && nonDirectivePhotos.length > 0 && (
                    <div style={{
                        marginBottom: '30px',
                        display: 'grid',
                        gridTemplateColumns: nonDirectivePhotos.length === 1 ? '1fr' : 'repeat(2, 1fr)',
                        gap: '12px',
                    }}>
                        {nonDirectivePhotos.map((photo: any, pIdx: number) => (
                            <div key={photo.id} style={{ position: 'relative' }}>
                                {(base64Images as any)[photo.id] ? (
                                    <img src={(base64Images as any)[photo.id]} alt={`Photo ${pIdx + 1}`}
                                        style={{
                                            width: '100%', height: 'auto', maxHeight: '300px', objectFit: 'cover',
                                            borderRadius: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                                            border: '3px solid #f0f0f0',
                                        }}
                                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                    />
                                ) : (
                                    <div style={{ padding: '30px', backgroundColor: '#f8f9fa', borderRadius: '10px', color: '#6c757d', border: '2px dashed #dee2e6', textAlign: 'center' }}>
                                        ⏳ Image en cours de chargement...
                                    </div>
                                )}
                                <span style={{
                                    position: 'absolute', top: '8px', left: '8px',
                                    width: '24px', height: '24px', borderRadius: '50%',
                                    backgroundColor: '#3b82f6', color: 'white',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '12px', fontWeight: 'bold',
                                }}>{pIdx + 1}</span>
                            </div>
                        ))}
                    </div>
                )}

                {/* Block-based fields keyed by groupId */}
                {renderBlockField(group.groupId, 'observation', 'Observations', '#e74c3c', '#fffafa', '#fee', '🔍')}
                {renderBlockField(group.groupId, 'recommendation', 'Recommandations', '#3498db', '#f0f8ff', '#e3f2fd', '💡')}
                {renderBlockField(group.groupId, 'references', 'Références', '#9b59b6', '#faf8fc', '#f3e5f5', '🏛️')}

                {/* Directives */}
                {group.directives && (
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{
                            fontWeight: '700', display: 'flex', marginBottom: '10px', fontSize: '15px',
                            color: '#2c3e50', alignItems: 'center', gap: '8px',
                        }}>
                            <span style={{ width: '4px', height: '20px', backgroundColor: '#2c3e50', borderRadius: '2px' }}></span>
                            📋 Directives
                        </label>
                        <div style={{
                            padding: '12px 15px', backgroundColor: '#f8f9fa', borderRadius: '8px',
                            fontSize: '14px', color: '#555', lineHeight: '1.6', borderLeft: '4px solid #6c757d',
                        }}>
                            {group.directives}
                        </div>
                    </div>
                )}

                {/* Comments */}
                <div style={{ marginBottom: '15px' }}>
                    <label style={{
                        fontWeight: '700', display: 'flex', marginBottom: '10px', fontSize: '15px',
                        color: '#f39c12', alignItems: 'center', gap: '8px',
                    }}>
                        <span style={{ width: '4px', height: '20px', backgroundColor: '#f39c12', borderRadius: '2px' }}></span>
                        💬 Commentaires du coordonnateur
                    </label>
                    {isEditing ? (
                        <textarea
                            value={group.comment || ''}
                            onChange={(e) => handleCommentChange(e, group.groupId)}
                            placeholder="Ajouter un commentaire..."
                            style={{
                                width: '100%', minHeight: '80px', padding: '12px',
                                fontFamily: 'system-ui, sans-serif', fontSize: '14px', lineHeight: '1.6',
                                borderRadius: '8px', border: '1.5px solid #fef5e7', resize: 'vertical',
                                backgroundColor: '#fffbf0', outline: 'none',
                            }}
                            onFocus={(e) => { e.target.style.borderColor = '#f39c12'; }}
                            onBlur={(e) => { e.target.style.borderColor = '#fef5e7'; }}
                        />
                    ) : (
                        group.comment ? (
                            <div style={{
                                padding: '15px', backgroundColor: '#fffbf0',
                                borderRadius: '8px', borderLeft: '4px solid #f39c12',
                                fontFamily: 'monospace', fontSize: '14px', color: '#555', lineHeight: '1.8',
                            }}>
                                {group.comment}
                            </div>
                        ) : (
                            <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', padding: '8px' }}>Aucun commentaire</p>
                        )
                    )}
                </div>
            </div>
        );
    };

    const groupsWithAnalysis = photoGroups.filter(g => g.analysis);

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
            {isEditing ? (
                <div>
                    {/* Header */}
                    <div style={{
                        marginBottom: '30px', border: '2px solid #4a90e2', borderRadius: '12px',
                        padding: '25px', backgroundColor: '#f0f8ff',
                        boxShadow: '0 4px 12px rgba(74, 144, 226, 0.1)',
                    }}>
                        <label style={{ fontWeight: '700', display: 'block', marginBottom: '12px', fontSize: '16px', color: '#2c3e50' }}>
                            📝 En-tête du rapport
                        </label>
                        <textarea
                            value={header}
                            onChange={(e) => setHeader(e.target.value)}
                            placeholder="Ajouter un en-tête (optionnel)..."
                            style={{
                                width: '100%', minHeight: '150px', padding: '15px',
                                fontFamily: 'monospace', fontSize: '14px', borderRadius: '8px',
                                border: '2px solid #d1e7fd', resize: 'vertical', outline: 'none',
                            }}
                        />
                    </div>

                    {/* Section title */}
                    <div style={{
                        marginBottom: '35px', padding: '20px', backgroundColor: '#fff9e6',
                        borderRadius: '12px', border: '2px solid #ffd700',
                    }}>
                        <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '700', color: '#856404', letterSpacing: '1px' }}>
                            📋 OBSERVATIONS PRINCIPALES ({groupsWithAnalysis.length} groupe(s))
                        </h3>
                    </div>

                    {groupsWithAnalysis.map((group, index) => renderGroup(group, index))}

                    {/* Footer */}
                    <div style={{
                        marginTop: '40px', border: '2px solid #27ae60', borderRadius: '12px',
                        padding: '25px', backgroundColor: '#f0fff4',
                    }}>
                        <label style={{ fontWeight: '700', display: 'block', marginBottom: '12px', fontSize: '16px', color: '#2c3e50' }}>
                            📄 Pied de page du rapport
                        </label>
                        <textarea
                            value={footer}
                            onChange={(e) => setFooter(e.target.value)}
                            placeholder="Ajouter un pied de page (optionnel)..."
                            style={{
                                width: '100%', minHeight: '150px', padding: '15px',
                                fontFamily: 'monospace', fontSize: '14px', borderRadius: '8px',
                                border: '2px solid #d5f4e6', resize: 'vertical', outline: 'none',
                            }}
                        />
                    </div>
                </div>
            ) : (
                /* Read mode */
                <div style={{
                    whiteSpace: 'pre-wrap', fontFamily: 'system-ui, -apple-system, sans-serif',
                    lineHeight: '1.8', backgroundColor: '#ffffff', padding: '40px',
                    borderRadius: '12px', border: '1px solid #e0e0e0', boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                }}>
                    {header && (
                        <div style={{ marginBottom: '30px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '8px', borderLeft: '4px solid #4a90e2' }}>
                            {header}
                        </div>
                    )}

                    <h2 style={{
                        fontSize: '24px', fontWeight: '700', color: '#2c3e50', marginBottom: '30px',
                        borderBottom: '3px solid #ffd700', paddingBottom: '12px', letterSpacing: '1px',
                    }}>
                        📋 OBSERVATIONS PRINCIPALES ({groupsWithAnalysis.length} groupe(s))
                    </h2>

                    {groupsWithAnalysis.map((group, index) => renderGroup(group, index))}

                    {footer && (
                        <div style={{ marginTop: '40px', padding: '20px', backgroundColor: '#f0fff4', borderRadius: '8px', borderLeft: '4px solid #27ae60' }}>
                            {footer}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default PhotoReportEditor;
