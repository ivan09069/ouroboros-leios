use blst::min_sig::*;
use quickcheck::{Arbitrary, Gen};
use serde::{Deserialize, Serialize};

use crate::bls_vote;
use crate::key::{PubKey, SecKey, Sig};
use crate::primitive::{arbitrary_poolkeyhash, EbHash, Eid, PoolKeyhash};
use crate::registry::PersistentId;
use crate::util::*;

#[derive(PartialEq, Eq, Debug, Clone, Serialize, Deserialize)]
pub enum Vote {
    Persistent {
        persistent: PersistentId, //   2 bytes
        eid: Eid,                 //   8 bytes
        eb: EbHash,               //  32 bytes
        sigma_m: Sig,             //  48 bytes
    }, //  90 bytes
    Nonpersistent {
        pool: PoolKeyhash, //  28 bytes
        eid: Eid,          //   8 bytes
        eb: EbHash,        //  32 bytes
        sigma_eid: Sig,    //  48 bytes
        sigma_m: Sig,      //  48 bytes
    }, // 164 bytes
}

impl Arbitrary for Vote {
    fn arbitrary(g: &mut Gen) -> Self {
        let sk: SecretKey = SecKey::arbitrary(g).0;
        let eid: [u8; 8] = arbitrary_fixed_bytes(g);
        let msg: [u8; 10] = arbitrary_fixed_bytes(g);
        if bool::arbitrary(g) {
            let sigma_m = bls_vote::gen_sig(&sk, &eid, &msg);
            Vote::Persistent {
                persistent: PersistentId::arbitrary(g),
                eid: Eid::arbitrary(g),
                eb: EbHash::arbitrary(g),
                sigma_m: Sig(sigma_m),
            }
        } else {
            let (sigma_eid, sigma_m) = bls_vote::gen_vote(&sk, &eid, &msg);
            Vote::Nonpersistent {
                pool: arbitrary_poolkeyhash(g),
                eid: Eid::arbitrary(g),
                eb: EbHash::arbitrary(g),
                sigma_eid: Sig(sigma_eid),
                sigma_m: Sig(sigma_m),
            }
        }
    }
}

pub fn gen_vote_persistent(peristent: &PersistentId, eid: &Eid, m: &EbHash, sk: &SecKey) -> Vote {
    let sigma_m = bls_vote::gen_sig(&sk.0, &eid.bytes(), &m.bytes());
    Vote::Persistent {
        persistent: peristent.clone(),
        eid: eid.clone(),
        eb: m.clone(),
        sigma_m: Sig(sigma_m),
    }
}

pub fn gen_vote_nonpersistent(pool: &PoolKeyhash, eid: &Eid, m: &EbHash, sk: &SecKey) -> Vote {
    let (sigma_eid, sigma_m) = bls_vote::gen_vote(&sk.0, &eid.bytes(), &m.bytes());
    Vote::Nonpersistent {
        pool: *pool,
        eid: eid.clone(),
        eb: m.clone(),
        sigma_eid: Sig(sigma_eid),
        sigma_m: Sig(sigma_m),
    }
}

pub fn verify_vote(mvk: &PubKey, vote: &Vote) -> bool {
    match vote {
        Vote::Persistent {
            persistent: _,
            eid,
            eb,
            sigma_m,
        } => bls_vote::verify_sig(&mvk.0, &eid.bytes(), &eb.bytes(), &sigma_m.0),
        Vote::Nonpersistent {
            pool: _,
            eid,
            eb,
            sigma_eid,
            sigma_m,
        } => bls_vote::verify_vote(&mvk.0, &eid.bytes(), &eb.bytes(), &(sigma_eid.0, sigma_m.0)),
    }
}
