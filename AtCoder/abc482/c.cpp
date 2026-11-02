#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll h, w, n ,q; cin >> h >> w >> n >> q;
	vector<pair<ll, ll>> v;
	map<ll, ll> mph, mpw;
	for (ll i = 0; i < n; i++) {
		ll x, y; cin >> x >> y;
		v.emplace_back(x, y);
		mph[x]++;
		mpw[y]++;
	}
	for (auto i = mph.begin(); i != mph.end(); i++) {
		if (i != mph.begin()) {
			auto it = i;
			mph[i->first] += mph[(--it)->first];
		}
	}
	for (auto i = mpw.begin(); i != mpw.end(); i++) {
		if (i != mpw.begin()) {
			auto it = i;
			mpw[i->first] += mpw[(--it)->first];
		}
	}
	mph[0] =0;
	mpw[0] =0;
	while (q--) {
		ll x, y, z; cin >> x >> y >> z;
		if (x == 1) {
			auto u = mph.lower_bound(y);
			if (u == mph.end()) {
				cout << 0 << endl;
				continue;
			}
			--u;
			auto d = mph.upper_bound(z);
			--d;
			if (d == mpw.begin()) {
				cout << 0 << endl;
				continue;
			}
			cout << d->second - u->second << endl;
		} else if (x == 2) {
			auto l = mpw.lower_bound(y);
			if (l == mpw.end()) {
				cout << 0 << endl;
				continue;
			}
			--l;
			auto r = mpw.upper_bound(z);
			--r;
			if (r == mpw.begin()) {
				cout << 0 << endl;
				continue;
			}
			cout << r->second - l->second << endl;
		}
	}
	return 0;
}

int main() {
	solve();
    return 0;
}
