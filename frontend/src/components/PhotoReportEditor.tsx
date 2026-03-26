import React, { useState, useEffect } from 'react';

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

    // État local pour le texte brut pendant l'édition
    const [editingTexts, setEditingTexts] = useState({});

    useEffect(() => {
        loadImages();
    }, []);

    useEffect(() => {
        setHeader(editedHeader);
    }, [editedHeader]);

    useEffect(() => {
        setFooter(editedFooter);
    }, [editedFooter]);

    useEffect(() => {
        setPhotos(initialPhotos);
        // Initialiser les textes d'édition
        const texts = {};
        initialPhotos.forEach(photo => {
            texts[`${photo.id}-observation`] = formatArrayToBullets(photo.analysis.observation);
            texts[`${photo.id}-recommendation`] = formatArrayToBullets(photo.analysis.recommendation);
            texts[`${photo.id}-references`] = formatArrayToBullets(photo.analysis.references);
        });
        setEditingTexts(texts);
    }, [initialPhotos]);

    // Notifier le parent des changements
    useEffect(() => {
        if (onPhotosChange) {
            onPhotosChange(photos);
        }
    }, [photos]);

    useEffect(() => {
        if (onHeaderChange) {
            onHeaderChange(header);
        }
    }, [header]);

    useEffect(() => {
        if (onFooterChange) {
            onFooterChange(footer);
        }
    }, [footer]);

    const loadImages = async () => {
        setLoading(true);
        try {
            const imagesMap = {};

            await Promise.all(initialPhotos?.map(async (photo) => {
                try {
                    const base64 = await downloadImages(photo.s3Url);
                    console.log(`Image chargée pour ${photo.id}:`, base64 ? 'OK' : 'VIDE');

                    if (base64) {
                        if (base64.startsWith('data:image')) {
                            imagesMap[photo.id] = base64;
                        } else {
                            imagesMap[photo.id] = `data:image/jpeg;base64,${base64}`;
                        }
                    }
                } catch (error) {
                    console.error(`Erreur chargement image ${photo.id}:`, error);
                }
            }));

            console.log('Images chargées:', Object.keys(imagesMap).length);
            setBase64Images(imagesMap);
        } catch (error) {
            console.error('Erreur lors du chargement des images:', error);
        } finally {
            setLoading(false);
        }
    };

    const getRiskLevelLabel = (level) => {
        const levels = {
            'eleve': 'HIGH',
            'moyen': 'MEDIUM',
            'faible': 'LOW'
        };
        return levels[level] || level.toUpperCase();
    };

    const getRiskLevelColor = (level) => {
        const colors = {
            'eleve': '#dc3545',
            'moyen': '#ffc107',
            'faible': '#28a745'
        };
        return colors[level] || '#6c757d';
    };

    const handleKeyDown = (e, photoId, field) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const textarea = e.target;
            const cursorPosition = textarea.selectionStart;
            const currentValue = textarea.value;

            const newValue =
                currentValue.substring(0, cursorPosition) +
                '\n• ' +
                currentValue.substring(cursorPosition);

            const key = `${photoId}-${field}`;
            setEditingTexts(prev => ({
                ...prev,
                [key]: newValue
            }));

            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = cursorPosition + 3;
            }, 0);
        }
    };

    const handleTextChange = (e, photoId, field) => {
        const value = e.target.value;
        const key = `${photoId}-${field}`;

        setEditingTexts(prev => ({
            ...prev,
            [key]: value
        }));
    };

    const handleTextBlur = (photoId, field) => {
        const key = `${photoId}-${field}`;
        const value = editingTexts[key] || '';

        setPhotos(prevPhotos =>
            prevPhotos.map(photo => {
                if (photo.id === photoId) {
                    return {
                        ...photo,
                        analysis: {
                            ...photo.analysis,
                            [field]: value.split('\n')
                                .map(line => line.replace(/^•\s*/, '').trim())
                                .filter(line => line.length > 0)
                        }
                    };
                }
                return photo;
            })
        );
    };

    const handleCommentChange = (e, photoId) => {
        const value = e.target.value;
        setPhotos(prevPhotos =>
            prevPhotos.map(photo => {
                if (photo.id === photoId) {
                    return { ...photo, comment: value };
                }
                return photo;
            })
        );
    };

    const formatArrayToBullets = (arr) => {
        return arr.map(item => `• ${item}`).join('\n');
    };

    if (loading) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                fontSize: '16px',
                color: '#555'
            }}>
                ⏳ Chargement des images...
            </div>
        );
    }

    return (
        <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
            {isEditing ? (
                /* Mode Édition */
                <div>
                    {/* Édition Header */}
                    <div style={{
                        marginBottom: '30px',
                        border: '2px solid #4a90e2',
                        borderRadius: '12px',
                        padding: '25px',
                        backgroundColor: '#f0f8ff',
                        boxShadow: '0 4px 12px rgba(74, 144, 226, 0.1)',
                        transition: 'all 0.3s ease'
                    }}>
                        <label style={{
                            fontWeight: '700',
                            display: 'block',
                            marginBottom: '12px',
                            fontSize: '16px',
                            color: '#2c3e50',
                            letterSpacing: '0.5px'
                        }}>
                            📝 En-tête du rapport
                        </label>
                        <textarea
                            value={header}
                            onChange={(e) => setHeader(e.target.value)}
                            placeholder="Ajouter un en-tête (optionnel)..."
                            style={{
                                width: '100%',
                                minHeight: '150px',
                                padding: '15px',
                                fontFamily: 'monospace',
                                fontSize: '14px',
                                borderRadius: '8px',
                                border: '2px solid #d1e7fd',
                                resize: 'vertical',
                                transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
                                outline: 'none'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#4a90e2';
                                e.target.style.boxShadow = '0 0 0 3px rgba(74, 144, 226, 0.1)';
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = '#d1e7fd';
                                e.target.style.boxShadow = 'none';
                            }}
                        />
                    </div>

                    {/* Photos Section */}
                    <div style={{
                        marginBottom: '35px',
                        padding: '20px',
                        backgroundColor: '#fff9e6',
                        borderRadius: '12px',
                        border: '2px solid #ffd700',
                        boxShadow: '0 4px 12px rgba(255, 215, 0, 0.15)'
                    }}>
                        <h3 style={{
                            margin: 0,
                            fontSize: '20px',
                            fontWeight: '700',
                            color: '#856404',
                            letterSpacing: '1px'
                        }}>
                            📋 OBSERVATIONS PRINCIPALES
                        </h3>
                    </div>

                    {photos.map((photo, index) => (
                        <div key={photo.id} style={{
                            marginBottom: '50px',
                            border: `3px solid ${getRiskLevelColor(photo.analysis.riskLevel)}`,
                            borderRadius: '16px',
                            padding: '30px',
                            backgroundColor: '#ffffff',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                            position: 'relative'
                        }}>
                            {/* Badge niveau de risque */}
                            <div style={{
                                position: 'absolute',
                                top: '-15px',
                                right: '30px',
                                backgroundColor: getRiskLevelColor(photo.analysis.riskLevel),
                                color: 'white',
                                padding: '8px 20px',
                                borderRadius: '20px',
                                fontWeight: 'bold',
                                fontSize: '13px',
                                boxShadow: '0 4px 8px rgba(0,0,0,0.2)',
                                letterSpacing: '0.5px'
                            }}>
                                {getRiskLevelLabel(photo.analysis.riskLevel)}
                            </div>

                            <h3 style={{
                                marginBottom: '25px',
                                fontSize: '22px',
                                fontWeight: '700',
                                color: '#2c3e50',
                                borderBottom: `3px solid ${getRiskLevelColor(photo.analysis.riskLevel)}`,
                                paddingBottom: '12px'
                            }}>
                                📸 Photo {index + 1}
                            </h3>

                            {/* Image Base64 */}
                            <div style={{ marginBottom: '30px', textAlign: 'center' }}>
                                {base64Images[photo.id] ? (
                                    <img
                                        src={base64Images[photo.id]}
                                        alt={`Photo ${index + 1}`}
                                        style={{
                                            maxWidth: '100%',
                                            width: '100%',
                                            height: 'auto',
                                            borderRadius: '12px',
                                            boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
                                            border: '4px solid #f0f0f0',
                                            transition: 'transform 0.3s ease'
                                        }}
                                        onMouseEnter={(e) => (e.target as HTMLElement).style.transform = 'scale(1.02)'}
                                        onMouseLeave={(e) => (e.target as HTMLElement).style.transform = 'scale(1)'}
                                        onError={(e) => {
                                            console.error('Erreur chargement image:', photo.id);
                                            (e.target as HTMLElement).style.display = 'none';
                                        }}
                                    />
                                ) : (
                                    <div style={{
                                        padding: '40px',
                                        backgroundColor: '#f8f9fa',
                                        borderRadius: '12px',
                                        color: '#6c757d',
                                        fontSize: '15px',
                                        border: '2px dashed #dee2e6'
                                    }}>
                                        ⏳ Image en cours de chargement...
                                    </div>
                                )}
                                <p style={{
                                    fontSize: '11px',
                                    color: '#999',
                                    marginTop: '12px',
                                    textAlign: 'left',
                                    fontStyle: 'italic'
                                }}>
                                    🔗 {photo.s3Url}
                                </p>
                            </div>

                            {/* Observations */}
                            <div style={{ marginBottom: '25px' }}>
                                <label style={{
                                    fontWeight: '700',
                                    display: 'flex',
                                    marginBottom: '10px',
                                    fontSize: '16px',
                                    color: '#e74c3c',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '20px',
                                        backgroundColor: '#e74c3c',
                                        borderRadius: '2px'
                                    }}></span>
                                    Observations
                                </label>
                                <textarea
                                    value={editingTexts[`${photo.id}-observation`] || ''}
                                    onChange={(e) => handleTextChange(e, photo.id, 'observation')}
                                    onKeyDown={(e) => handleKeyDown(e, photo.id, 'observation')}
                                    style={{
                                        width: '100%',
                                        minHeight: '180px',
                                        padding: '15px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.8',
                                        borderRadius: '8px',
                                        border: '2px solid #fee',
                                        resize: 'vertical',
                                        backgroundColor: '#fffafa',
                                        transition: 'all 0.3s ease',
                                        outline: 'none'
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = '#e74c3c';
                                        e.target.style.boxShadow = '0 0 0 3px rgba(231, 76, 60, 0.1)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = '#fee';
                                        e.target.style.boxShadow = 'none';
                                        handleTextBlur(photo.id, 'observation');
                                    }}
                                />
                            </div>

                            {/* Recommandations */}
                            <div style={{ marginBottom: '25px' }}>
                                <label style={{
                                    fontWeight: '700',
                                    display: 'flex',
                                    marginBottom: '10px',
                                    fontSize: '16px',
                                    color: '#3498db',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '20px',
                                        backgroundColor: '#3498db',
                                        borderRadius: '2px'
                                    }}></span>
                                    Recommandations
                                </label>
                                <textarea
                                    value={editingTexts[`${photo.id}-recommendation`] || ''}
                                    onChange={(e) => handleTextChange(e, photo.id, 'recommendation')}
                                    onKeyDown={(e) => handleKeyDown(e, photo.id, 'recommendation')}
                                    style={{
                                        width: '100%',
                                        minHeight: '180px',
                                        padding: '15px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.8',
                                        borderRadius: '8px',
                                        border: '2px solid #e3f2fd',
                                        resize: 'vertical',
                                        backgroundColor: '#f0f8ff',
                                        transition: 'all 0.3s ease',
                                        outline: 'none'
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = '#3498db';
                                        e.target.style.boxShadow = '0 0 0 3px rgba(52, 152, 219, 0.1)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = '#e3f2fd';
                                        e.target.style.boxShadow = 'none';
                                        handleTextBlur(photo.id, 'recommendation');
                                    }}
                                />
                            </div>

                            {/* Références */}
                            <div style={{ marginBottom: '25px' }}>
                                <label style={{
                                    fontWeight: '700',
                                    display: 'flex',
                                    marginBottom: '10px',
                                    fontSize: '16px',
                                    color: '#9b59b6',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '20px',
                                        backgroundColor: '#9b59b6',
                                        borderRadius: '2px'
                                    }}></span>
                                    🏛️ Références
                                </label>
                                <textarea
                                    value={editingTexts[`${photo.id}-references`] || ''}
                                    onChange={(e) => handleTextChange(e, photo.id, 'references')}
                                    onKeyDown={(e) => handleKeyDown(e, photo.id, 'references')}
                                    style={{
                                        width: '100%',
                                        minHeight: '120px',
                                        padding: '15px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.8',
                                        borderRadius: '8px',
                                        border: '2px solid #f3e5f5',
                                        resize: 'vertical',
                                        backgroundColor: '#faf8fc',
                                        transition: 'all 0.3s ease',
                                        outline: 'none'
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = '#9b59b6';
                                        e.target.style.boxShadow = '0 0 0 3px rgba(155, 89, 182, 0.1)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = '#f3e5f5';
                                        e.target.style.boxShadow = 'none';
                                        handleTextBlur(photo.id, 'references');
                                    }}
                                />
                            </div>

                            {/* Commentaires */}
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{
                                    fontWeight: '700',
                                    display: 'flex',
                                    marginBottom: '10px',
                                    fontSize: '16px',
                                    color: '#f39c12',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '20px',
                                        backgroundColor: '#f39c12',
                                        borderRadius: '2px'
                                    }}></span>
                                    💬 Commentaires du coordonnateur
                                </label>
                                <textarea
                                    value={photo.comment}
                                    onChange={(e) => handleCommentChange(e, photo.id)}
                                    placeholder="Ajouter un commentaire..."
                                    style={{
                                        width: '100%',
                                        minHeight: '100px',
                                        padding: '15px',
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        lineHeight: '1.8',
                                        borderRadius: '8px',
                                        border: '2px solid #fef5e7',
                                        resize: 'vertical',
                                        backgroundColor: '#fffbf0',
                                        transition: 'all 0.3s ease',
                                        outline: 'none'
                                    }}
                                    onFocus={(e) => {
                                        e.target.style.borderColor = '#f39c12';
                                        e.target.style.boxShadow = '0 0 0 3px rgba(243, 156, 18, 0.1)';
                                    }}
                                    onBlur={(e) => {
                                        e.target.style.borderColor = '#fef5e7';
                                        e.target.style.boxShadow = 'none';
                                    }}
                                />
                            </div>
                        </div>
                    ))}

                    {/* Édition Footer */}
                    <div style={{
                        marginTop: '40px',
                        border: '2px solid #27ae60',
                        borderRadius: '12px',
                        padding: '25px',
                        backgroundColor: '#f0fff4',
                        boxShadow: '0 4px 12px rgba(39, 174, 96, 0.1)'
                    }}>
                        <label style={{
                            fontWeight: '700',
                            display: 'block',
                            marginBottom: '12px',
                            fontSize: '16px',
                            color: '#2c3e50',
                            letterSpacing: '0.5px'
                        }}>
                            📄 Pied de page du rapport
                        </label>
                        <textarea
                            value={footer}
                            onChange={(e) => setFooter(e.target.value)}
                            placeholder="Ajouter un pied de page (optionnel)..."
                            style={{
                                width: '100%',
                                minHeight: '150px',
                                padding: '15px',
                                fontFamily: 'monospace',
                                fontSize: '14px',
                                borderRadius: '8px',
                                border: '2px solid #d5f4e6',
                                resize: 'vertical',
                                transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
                                outline: 'none'
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = '#27ae60';
                                e.target.style.boxShadow = '0 0 0 3px rgba(39, 174, 96, 0.1)';
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = '#d5f4e6';
                                e.target.style.boxShadow = 'none';
                            }}
                        />
                    </div>
                </div>
            ) : (
                /* Mode Lecture */
                <div style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    lineHeight: '1.8',
                    backgroundColor: '#ffffff',
                    padding: '40px',
                    borderRadius: '12px',
                    border: '1px solid #e0e0e0',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.08)'
                }}>
                    {/* Header */}
                    {header && (
                        <div style={{
                            marginBottom: '30px',
                            padding: '20px',
                            backgroundColor: '#f8f9fa',
                            borderRadius: '8px',
                            borderLeft: '4px solid #4a90e2'
                        }}>
                            {header}
                        </div>
                    )}

                    {/* Content principal */}
                    <h2 style={{
                        fontSize: '24px',
                        fontWeight: '700',
                        color: '#2c3e50',
                        marginBottom: '30px',
                        borderBottom: '3px solid #ffd700',
                        paddingBottom: '12px',
                        letterSpacing: '1px'
                    }}>
                        📋 OBSERVATIONS PRINCIPALES
                    </h2>
                    {photos.map((photo, index) => (
                        <div key={photo.id} style={{
                            marginBottom: '40px',
                            padding: '30px',
                            backgroundColor: '#fafafa',
                            borderRadius: '12px',
                            border: `3px solid ${getRiskLevelColor(photo.analysis.riskLevel)}`,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
                        }}>
                            <div style={{
                                borderBottom: '2px solid #e0e0e0',
                                paddingBottom: '15px',
                                marginBottom: '20px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}>
                                <h3 style={{
                                    margin: 0,
                                    fontSize: '20px',
                                    fontWeight: '700',
                                    color: '#2c3e50'
                                }}>
                                    📸 Photo {index + 1}
                                </h3>
                                <span style={{
                                    backgroundColor: getRiskLevelColor(photo.analysis.riskLevel),
                                    color: 'white',
                                    padding: '6px 16px',
                                    borderRadius: '20px',
                                    fontSize: '13px',
                                    fontWeight: 'bold',
                                    letterSpacing: '0.5px'
                                }}>
                                    {getRiskLevelLabel(photo.analysis.riskLevel)}
                                </span>
                            </div>

                            {base64Images[photo.id] && (
                                <div style={{ marginBottom: '25px' }}>
                                    <img
                                        src={base64Images[photo.id]}
                                        alt={`Photo ${index + 1}`}
                                        style={{
                                            maxWidth: '100%',
                                            width: '100%',
                                            height: 'auto',
                                            margin: '15px 0',
                                            borderRadius: '10px',
                                            boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
                                            border: '4px solid white'
                                        }}
                                        onError={(e) => {
                                            console.error('Erreur chargement image lecture:', photo.id);
                                            (e.target as HTMLElement).style.display = 'none';
                                        }}
                                    />
                                </div>
                            )}

                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{
                                    fontSize: '16px',
                                    fontWeight: '700',
                                    color: '#e74c3c',
                                    marginBottom: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '16px',
                                        backgroundColor: '#e74c3c',
                                        borderRadius: '2px'
                                    }}></span>
                                    Observations
                                </h4>
                                <div style={{
                                    fontFamily: 'monospace',
                                    fontSize: '14px',
                                    paddingLeft: '12px',
                                    lineHeight: '1.8'
                                }}>
                                    {photo.analysis.observation.map((obs, i) => `• ${obs}\n`).join('')}
                                </div>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{
                                    fontSize: '16px',
                                    fontWeight: '700',
                                    color: '#3498db',
                                    marginBottom: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '16px',
                                        backgroundColor: '#3498db',
                                        borderRadius: '2px'
                                    }}></span>
                                    Recommandations
                                </h4>
                                <div style={{
                                    fontFamily: 'monospace',
                                    fontSize: '14px',
                                    paddingLeft: '12px',
                                    lineHeight: '1.8'
                                }}>
                                    {photo.analysis.recommendation.map((rec, i) => `• ${rec}\n`).join('')}
                                </div>
                            </div>

                            <div style={{ marginBottom: '20px' }}>
                                <h4 style={{
                                    fontSize: '16px',
                                    fontWeight: '700',
                                    color: '#9b59b6',
                                    marginBottom: '10px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <span style={{
                                        width: '4px',
                                        height: '16px',
                                        backgroundColor: '#9b59b6',
                                        borderRadius: '2px'
                                    }}></span>
                                    🏛️ Références
                                </h4>
                                <div style={{
                                    fontFamily: 'monospace',
                                    fontSize: '14px',
                                    paddingLeft: '12px',
                                    lineHeight: '1.8'
                                }}>
                                    {photo.analysis.references.map((ref, i) => `• ${ref}\n`).join('')}
                                </div>
                            </div>

                            {photo.comment && (
                                <div style={{
                                    marginTop: '20px',
                                    padding: '15px',
                                    backgroundColor: '#fffbf0',
                                    borderRadius: '8px',
                                    borderLeft: '4px solid #f39c12'
                                }}>
                                    <h4 style={{
                                        fontSize: '16px',
                                        fontWeight: '700',
                                        color: '#f39c12',
                                        marginBottom: '10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px'
                                    }}>
                                        💬 Commentaires du coordonnateur
                                    </h4>
                                    <div style={{
                                        fontFamily: 'monospace',
                                        fontSize: '14px',
                                        color: '#555',
                                        lineHeight: '1.8'
                                    }}>
                                        {photo.comment}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}

                    {/* Footer */}
                    {footer && (
                        <div style={{
                            marginTop: '40px',
                            padding: '20px',
                            backgroundColor: '#f0fff4',
                            borderRadius: '8px',
                            borderLeft: '4px solid #27ae60'
                        }}>
                            {footer}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default PhotoReportEditor;
