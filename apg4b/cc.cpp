#include <bits/stdc++.h>
#define ll long long int
using namespace std;

set<pair<long long, long long>> s;
long long total_b = 0;

void add(long long l, long long r) {
	long long left = l;
	long long right = r;
	auto it = s.lower_bound({left, -1});

	if (it != s.begin()) {
		it--;
		if (it->second < left) {
			it++;
		}
	}
	while (it != s.end()) {
		if (it->first > right) break;
		total_b -= it->second - it->first + 1;
		left = min(left, it->first);
		right = max(right, it->second);
		it = s.erase(it);
	}

	s.insert({left, right});
	total_b += right - left + 1;
}

int main() {
	long long N; cin >> N;
	int Q; cin >> Q;

	while (Q--) {
		long long l, r;
		cin >> l >> r;
		add(l, r);
		cout << N - total_b << endl;
	}

	return 0;
}