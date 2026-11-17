#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n ,q; cin >> n >> q;
	vector<ll> v(q);
	vector<ll> ans(n);
	for (ll i= 0; i < n; i++) {
		cin >> v[i];
	}
	for (ll i = 0; i < n; i++) {
		if (v[i] != 0) {
			ll index = 0;
			for (ll j = 0; j < n; j++) {
				if (v[index] > v[j]) {
					index = j;
				}
			}
			ans[index]++;
		} else {
			ans[v[i] + 1]++;
		}
	}
	for (ll i = 0; i < n; i++) {
		cout << ans[i] << " " ;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

