#include <bits/stdc++.h>
#define ll long long
using namespace std;

// https://github.com/Aoki-3DPr/Atc

ll di[8] = {1, 0, -1, 0, 1, 1, -1, -1};
ll dj[8] = {0, 1, 0, -1, 1, -1, 1, -1};

ll solve() {
	ll n, q; cin >> n >> q;
	vector<ll> a(n);
	for (ll i = 0; i < n; i++) a[i] = i + 1;
	while(q--) {
		ll k; cin >> k;
		for (ll i = 0; i < k / 2; i++) {
			swap(a[i], a[k - 1 - i]);
			a[i] = -a[i];
			a[k - 1 - i] = -a[k - 1 - i];
		}
		if (k % 2 == 1) {
			a[k / 2] = -a[k / 2];
		}
	}
	for (ll i = 0; i < n; i++) {
		cout << a[i] << endl;
	}
	return 0;
}

int main() {
	solve();
    return 0;
}

